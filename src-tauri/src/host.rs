// Хост-режим: локальный relay, выставленный в интернет через Cloudflare
// Quick Tunnel. Туннель — тестовый (URL меняется при каждом старте), поэтому
// это осознанный MVP-компромисс; стабильный адрес — named tunnel/Coturn-хостинг.
//
// Что важно:
// - cloudflared НЕ бандлится: качается pinned-версия с проверкой SHA-256.
// - URL читается из stderr (cloudflared пишет логи туда, не в stdout).
// - после старта туннель проверяется снаружи через /health.
// - умерший процесс поднимается заново (до 3 попыток), статус летит в UI.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const CLOUDFLARED_VERSION: &str = "2026.10.3";
const RELAY_PORT: u16 = 8000;
const MAX_RESTARTS: u32 = 3;

struct PinnedAsset {
    url: &'static str,
    sha256: &'static str,
}

fn pinned_asset() -> Option<PinnedAsset> {
    if cfg!(target_os = "windows") {
        Some(PinnedAsset {
            url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe",
            sha256: "76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2",
        })
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        Some(PinnedAsset {
            url: "https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-linux-amd64",
            sha256: "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0",
        })
    } else {
        // macOS и ARM-Linux: официальные ассеты в .tgz / другой арх.
        // Пользователь может указать свой бинарь через NURCHAT_CLOUDFLARED
        // или положить cloudflared в PATH — см. docs/RELAY_HOSTING.md.
        None
    }
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct HostStatus {
    pub state: String,
    pub url: Option<String>,
    pub error: Option<String>,
}

/// Общий конфиг хост-режима: автозапуск и путь к своему cloudflared.
pub fn host_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("host.json"))
}

pub fn read_host_config(app: &AppHandle) -> serde_json::Value {
    host_config_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn write_host_config(app: &AppHandle, value: &serde_json::Value) -> Result<(), String> {
    let path = host_config_path(app).ok_or("Не удалось получить каталог приложения")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Путь, который пользователь выбрал вручную в настройках (не env).
pub fn saved_cloudflared_path(app: &AppHandle) -> Option<PathBuf> {
    read_host_config(app)
        .get("cloudflared_path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub struct HostManager {
    child: Mutex<Option<Child>>,
    status: Mutex<HostStatus>,
    generation: AtomicU64,
}

impl HostManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(HostStatus {
                state: "stopped".to_string(),
                url: None,
                error: None,
            }),
            generation: AtomicU64::new(0),
        }
    }

    pub async fn status(&self) -> HostStatus {
        self.status.lock().await.clone()
    }

    async fn set_status(&self, app: &AppHandle, status: HostStatus) {
        *self.status.lock().await = status.clone();
        let _ = app.emit("host-status", status);
    }

    pub async fn publish_stopped(&self, app: &AppHandle) {
        self.set_status(
            app,
            HostStatus {
                state: "stopped".to_string(),
                url: None,
                error: None,
            },
        )
        .await;
    }

    /// Синхронная аварийная остановка для обработчиков выхода из приложения.
    pub fn kill_now(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.try_lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.start_kill();
            }
        }
    }

    pub async fn stop(&self) {
        // Инкремент поколения отменяет авто-restart и гонки со старым стартом.
        self.generation.fetch_add(1, Ordering::SeqCst);
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    pub fn start(self: &std::sync::Arc<Self>, app: AppHandle) {
        // Новый запуск отменяет предыдущий супервизор.
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = manager.run(&app, generation).await {
                if manager.generation.load(Ordering::SeqCst) == generation {
                    manager
                        .set_status(
                            &app,
                            HostStatus {
                                state: "error".to_string(),
                                url: None,
                                error: Some(err),
                            },
                        )
                        .await;
                }
            }
        });
    }

    async fn run(
        self: &std::sync::Arc<Self>,
        app: &AppHandle,
        generation: u64,
    ) -> Result<(), String> {
        self.set_status(
            app,
            HostStatus {
                state: "downloading".to_string(),
                url: None,
                error: None,
            },
        )
        .await;

        let binary = ensure_cloudflared(app).await?;
        if self.generation.load(Ordering::SeqCst) != generation {
            return Ok(());
        }

        let mut restarts = 0;
        loop {
            if self.generation.load(Ordering::SeqCst) != generation {
                return Ok(());
            }

            self.set_status(
                app,
                HostStatus {
                    state: "starting".to_string(),
                    url: None,
                    error: None,
                },
            )
            .await;

            let mut child = spawn_cloudflared(&binary)?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "cloudflared: нет stderr".to_string())?;
            let mut lines = BufReader::new(stderr).lines();

            let url = match wait_for_tunnel_url(&mut lines).await {
                Ok(url) => url,
                Err(err) => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    return Err(err);
                }
            };

            // Остаток stderr вычитываем в лог, иначе pipe переполнится и
            // cloudflared зависнет. Заодно видно проблемы туннеля.
            tokio::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    log::info!("[cloudflared] {}", line);
                }
            });

            *self.child.lock().await = Some(child);

            if let Err(err) = verify_public_health(&url).await {
                let mut guard = self.child.lock().await;
                if let Some(mut child) = guard.take() {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                }
                return Err(err);
            }

            if self.generation.load(Ordering::SeqCst) != generation {
                return Ok(());
            }

            self.set_status(
                app,
                HostStatus {
                    state: "ready".to_string(),
                    url: Some(url.clone()),
                    error: None,
                },
            )
            .await;

            // Ждём смерти процесса. try_wait под коротким lock, чтобы stop()
            // мог забрать child без ожидания вечного lock.
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let exited = {
                    let mut guard = self.child.lock().await;
                    match guard.as_mut() {
                        None => return Ok(()), // остановлено вручную
                        Some(child) => match child.try_wait() {
                            Ok(Some(_)) => true,
                            Ok(None) => false,
                            Err(_) => true,
                        },
                    }
                };
                if exited {
                    break;
                }
            }

            {
                let mut guard = self.child.lock().await;
                if let Some(mut child) = guard.take() {
                    let _ = child.wait().await;
                }
            }

            if self.generation.load(Ordering::SeqCst) != generation {
                return Ok(());
            }

            restarts += 1;
            if restarts > MAX_RESTARTS {
                return Err(
                    "Туннель упал несколько раз подряд. Проверьте интернет и firewall.".to_string(),
                );
            }
            self.set_status(
                app,
                HostStatus {
                    state: "restarting".to_string(),
                    url: None,
                    error: Some(format!(
                        "Туннель перезапускается ({restarts}/{MAX_RESTARTS})"
                    )),
                },
            )
            .await;
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }
}

async fn ensure_cloudflared(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. Явный путь от пользователя (свой бинарь / пакетный менеджер).
    if let Ok(custom) = std::env::var("NURCHAT_CLOUDFLARED") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "NURCHAT_CLOUDFLARED указывает на несуществующий файл: {path:?}"
        ));
    }

    // 2. Путь, указанный пользователем в Настройки → Хост-режим.
    if let Some(path) = saved_cloudflared_path(app) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "Сохранённый путь к cloudflared не найден: {path:?}. \
             Укажите файл заново в Настройки → Хост-режим."
        ));
    }

    // 3. cloudflared из PATH.
    if Command::new("cloudflared")
        .arg("--version")
        .output()
        .await
        .is_ok()
    {
        return Ok(PathBuf::from("cloudflared"));
    }

    let asset = pinned_asset().ok_or_else(|| {
        "Для этой ОС не поддерживается загрузка cloudflared автоматически. \
         Установите cloudflared вручную, укажите путь в Настройки → Хост-режим \
         или задайте NURCHAT_CLOUDFLARED."
            .to_string()
    })?;

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось получить каталог приложения: {e}"))?;
    let name = if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let dest = app_dir
        .join("cloudflared")
        .join(CLOUDFLARED_VERSION)
        .join(name);

    if dest.is_file() {
        if verify_sha256(&dest, asset.sha256)? {
            return Ok(dest);
        }
        let _ = std::fs::remove_file(&dest);
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать {:?}: {e}", parent))?;
    }

    let response = reqwest::get(asset.url)
        .await
        .map_err(|e| format!("Не удалось скачать cloudflared: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Скачивание cloudflared: HTTP {}",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Не удалось прочитать cloudflared: {e}"))?;

    let actual = hex_sha256(&bytes);
    if actual != asset.sha256 {
        return Err(format!(
            "SHA-256 cloudflared не совпал (ожидался {}, получен {}). Загрузка отклонена.",
            asset.sha256, actual
        ));
    }

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("Не удалось записать cloudflared: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).await;
    }

    Ok(dest)
}

fn verify_sha256(path: &std::path::Path, expected: &str) -> Result<bool, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Не удалось прочитать {path:?}: {e}"))?;
    Ok(hex_sha256(&bytes) == expected)
}

fn hex_sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn spawn_cloudflared(binary: &std::path::Path) -> Result<Child, String> {
    let mut cmd = Command::new(binary);
    cmd.args([
        "tunnel",
        "--url",
        &format!("http://127.0.0.1:{RELAY_PORT}"),
        "--no-autoupdate",
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::piped())
    .kill_on_drop(true);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|e| format!("Не удалось запустить cloudflared: {e}"))
}

async fn wait_for_tunnel_url(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStderr>>,
) -> Result<String, String> {
    let found = tokio::time::timeout(Duration::from_secs(45), async {
        while let Ok(Some(line)) = lines.next_line().await {
            log::info!("[cloudflared] {}", line);
            if let Some(url) = extract_tunnel_url(&line) {
                return Some(url);
            }
        }
        None
    })
    .await;

    match found {
        Ok(Some(url)) => Ok(url),
        Ok(None) => Err("cloudflared завершился, не выдав адрес туннеля".to_string()),
        Err(_) => Err("Туннель не поднялся за 45 секунд. Проверьте интернет.".to_string()),
    }
}

/// Достаёт https://*.trycloudflare.com из строки лога cloudflared.
fn extract_tunnel_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| matches!(c, '|' | '"' | '\'' | ',' | ';' | ')' | ']' | '>'))
        })
        .find(|word| word.starts_with("https://") && word.contains(".trycloudflare.com"))
        .map(|word| word.to_string())
}

async fn verify_public_health(url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // DNS у только что созданного quick-туннеля иногда отдаёт NXDOMAIN
    // первые десятки секунд — не сдаёмся слишком быстро.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    let mut last_error = String::from("нет ответа");
    while tokio::time::Instant::now() < deadline {
        match client.get(format!("{url}/health")).send().await {
            Ok(resp) => match resp.json::<serde_json::Value>().await {
                Ok(body) if body["service"] == "NurChat Server" => return Ok(()),
                Ok(_) => {
                    last_error = "по адресу туннеля отвечает не NurChat".to_string();
                }
                Err(e) => last_error = format!("некорректный /health: {e}"),
            },
            Err(e) => last_error = e.to_string(),
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    Err(format!(
        "Туннель создан, но снаружи /health не отвечает ({last_error}). \
         Проверьте firewall и что relay слушает 127.0.0.1:8000."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quick_tunnel_url_from_log() {
        let line = "2026-10-22T10:00:00Z INF |  https://quiet-river-1234.trycloudflare.com  |";
        assert_eq!(
            extract_tunnel_url(line).as_deref(),
            Some("https://quiet-river-1234.trycloudflare.com")
        );
        assert_eq!(extract_tunnel_url("INF no url here"), None);
        assert_eq!(extract_tunnel_url("https://example.com not a tunnel"), None);
    }

    #[test]
    fn pinned_hash_is_lowercase_hex() {
        if let Some(asset) = pinned_asset() {
            assert_eq!(asset.sha256.len(), 64);
            assert!(asset.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
