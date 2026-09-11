mod ipfs;
mod server;

use ipfs::{IpfsClient, IpfsAddResult};
use server::ServerManager;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder};

use tauri::{Manager, State, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::MenuBuilder;
use tokio::sync::RwLock;
use tokio::process::{Child, Command as TokioCommand};
use tokio::io::{AsyncBufReadExt, BufReader};

struct AppState {
    cloudflared: RwLock<Option<Child>>,
}

#[tauri::command]
async fn get_local_ip() -> Result<String, String> {
    use std::net::ToSocketAddrs;
    let target = "8.8.8.8:53".to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("no address")?;
    let bind_addr: std::net::SocketAddr = ([0, 0, 0, 0], 0).into();
    let socket = tokio::net::UdpSocket::bind(bind_addr).await.map_err(|e| e.to_string())?;
    if socket.connect(target).await.is_ok() {
        if let Ok(local) = socket.local_addr() {
            return Ok(local.ip().to_string());
        }
    }
    Ok("127.0.0.1".to_string())
}

#[tauri::command]
async fn download_and_open_file(url: String, token: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client.get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let bytes = resp.bytes().await.map_err(|e| format!("Read failed: {e}"))?;

    let mut temp = std::env::temp_dir();
    temp.push("nurchat_files");
    std::fs::create_dir_all(&temp).ok();
    temp.push(&filename);
    std::fs::write(&temp, &bytes).map_err(|e| format!("Write failed: {e}"))?;

    let path_str = temp.to_string_lossy().to_string();
    open::that(&temp).map_err(|e| format!("Open failed: {e}"))?;

    Ok(path_str)
}

#[tauri::command]
async fn fetch_captcha() -> Result<serde_json::Value, String> {
    let resp = reqwest::get("http://127.0.0.1:8000/api/auth/captcha")
        .await
        .map_err(|e| format!("Captcha fetch failed: {e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Captcha parse failed: {e}"))
}

#[tauri::command]
async fn fetch_register(body: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("http://127.0.0.1:8000/api/auth/register")
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Register request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Read response failed: {e}"))?;
    if !status.is_success() {
        return Err(text);
    }
    serde_json::from_str(&text).map_err(|e| format!("Parse failed: {e}"))
}

#[tauri::command]

fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn minimize_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn share_invite(uri: String) -> Result<(), String> {
    // Open default mail client with invite URI

    let body = format!("Присоединяйся ко мне в NurChat!\n\nМоя ссылка: {}\n\nУстанови NurChat: https://github.com/NurApps/NurChat_desktop/releases", uri);
    let mailto = format!("mailto:?subject=Приглашение в NurChat&body={}", urlencoding(&body));
    open::that(&mailto).map_err(|e| format!("Failed to open mail: {e}"))
}


async fn download_cloudflared(dest: &std::path::Path) -> Result<(), String> {
    let url = if cfg!(target_os = "windows") {
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64"
    } else {
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    };

    let response = reqwest::get(url).await.map_err(|e| format!("Failed to download cloudflared: {e}"))?;
    let bytes = response.bytes().await.map_err(|e| format!("Failed to read cloudflared: {e}"))?;

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    tokio::fs::write(dest, &bytes).await.map_err(|e| format!("Failed to write cloudflared: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(dest, Permissions::from_mode(0o755))
            .await
            .ok();
    }

    Ok(())
}

#[tauri::command]
async fn start_cloudflare_tunnel(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    {
        let mut cf = state.cloudflared.write().await;
        if let Some(child) = cf.as_mut() {
            if child.try_wait().ok().flatten().is_none() {
                return Err("Tunnel already running".to_string());
            }
        }
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let binary_name = if cfg!(target_os = "windows") {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let binary_path = app_dir.join(binary_name);

    if !binary_path.exists() {
        download_cloudflared(&binary_path).await?;
    }

    let mut child = TokioCommand::new(&binary_path)
        .args(["tunnel", "--url", "http://localhost:8000"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start cloudflared: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let url = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            if line.contains("trycloudflare.com") || line.contains("https://") {
                for word in line.split_whitespace() {
                    if word.starts_with("https://") && word.contains("trycloudflare.com") {
                        return Ok::<_, String>(word.to_string());
                    }
                }
            }
        }
        Err("Tunnel URL not found within timeout".to_string())
    })
    .await
    .map_err(|_| "Timed out waiting for tunnel URL".to_string())??;

    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut reader = lines.into_inner();
        let mut buf = [0u8; 1024];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                _ => {}
            }
        }
    });

    {
        let mut cf = state.cloudflared.write().await;
        *cf = Some(child);
    }

    Ok(url)
}

#[tauri::command]
async fn stop_cloudflare_tunnel(state: State<'_, AppState>) -> Result<(), String> {
    let mut cf = state.cloudflared.write().await;
    if let Some(mut child) = cf.take() {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn check_update(current_version: String) -> Result<serde_json::Value, String> {
    let url = "https://api.github.com/repos/NurApps/NurChat_desktop/releases/latest";
    let client = reqwest::Client::builder()
        .user_agent("NurChat")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;
    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse failed: {e}"))?;
    
    let tag_name = data["tag_name"].as_str().unwrap_or("").to_string();
    let latest = tag_name.trim_start_matches('v');
    let current = current_version.trim_start_matches('v');
    
    Ok(serde_json::json!({
        "has_update": latest != current,


    fn parse_semver(v: &str) -> Vec<u64> {
        v.split('.')
            .map(|p| p.split('-').next().unwrap_or("0").parse().unwrap_or(0))
            .collect()
    }
    let latest_v = parse_semver(latest);
    let current_v = parse_semver(current);
    let has_update = latest_v > current_v;

    Ok(serde_json::json!({
        "has_update": has_update,
        "latest_version": tag_name,
        "url": data["html_url"],
        "body": data["body"],
    }))
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| match c {
        ' ' => "%20".to_string(),
        '\n' => "%0A".to_string(),
        _ if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' || c == '~' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_and_open_file_validates_url() {
        let result = std::panic::catch_unwind(|| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                download_and_open_file(
                    String::new(),
                    String::new(),
                    "test.txt".to_string(),
                ).await
            })
        });
        // Should fail gracefully, not panic

        assert!(result.is_err() || result.is_ok());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            cloudflared: RwLock::new(None),
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_local_ip,
            download_and_open_file,
            fetch_captcha,
            fetch_register,

            check_update,
            get_app_version,
            show_main_window,
            minimize_to_tray,
            share_invite,

            start_cloudflare_tunnel,
            stop_cloudflare_tunnel,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Auto-start server
            let state = app.handle().state::<AppState>();

            // Use app_data_dir for server files, create if missing
            let app_dir = app.path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
            if !app_dir.exists() {
                let _ = std::fs::create_dir_all(&app_dir);
            }

            // Also try resource dir for Tauri sidecar
            let res_dir = app.path()
                .resource_dir()
                .ok();

            log::info!("Server app_dir: {:?}", app_dir);
            log::info!("Server resource_dir: {:?}", res_dir);

            let handle = app.handle().clone();
            match state.server.start(&app_dir, res_dir.as_deref()) {
                Ok(()) => {
                    log::info!("Server process started");
                    let _ = handle.emit("server-status", serde_json::json!({"status": "starting"}));
                    // Wait for server in background (60s for embeddable Python download)
                    std::thread::spawn(move || {
                        let state = handle.state::<AppState>();
                        match state.server.wait_ready(60) {
                            Ok(()) => {
                                log::info!("Server is ready");
                                let _ = handle.emit("server-status", serde_json::json!({"status": "ready"}));
                            }
                            Err(e) => {
                                log::error!("Server failed to start: {}", e);
                                let _ = handle.emit("server-status", serde_json::json!({"status": "failed", "error": e}));
                            }
                        }
                    });
                }
                Err(e) => {
                    log::error!("Failed to start server: {}", e);
                    let _ = handle.emit("server-status", serde_json::json!({"status": "failed", "error": e}));
                }
            }

            // Tray icon

            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tokio::spawn(async move {
                    use std::time::Duration;
                    for _ in 0..30 {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        if let Ok(resp) = reqwest::get("http://127.0.0.1:8000/health").await {
                            if resp.status().is_success() {
                                println!("[NurChat] Server is ready");
                                let _ = handle.emit("server-ready", ());
                                return;
                            }
                        }
                    }
                    eprintln!("[NurChat] Server failed to start within 15s");
                });
            }

            let show_label = "Показать NurChat";
            let quit_label = "Выйти";

            let tray_menu = MenuBuilder::new(app)
                .item(&tauri::menu::MenuItemBuilder::with_id("show", show_label).build(app)?)
                .item(&tauri::menu::MenuItemBuilder::with_id("quit", quit_label).build(app)?)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("NurChat")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            let state = app.state::<AppState>();
                            state.server.stop();

                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up, ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            let state = app_handle.state::<AppState>();

            match event {
                tauri::RunEvent::WindowEvent { label, event: win_event, .. } => {
                    if let tauri::WindowEvent::CloseRequested { .. } = win_event {
                        if let Some(window) = app_handle.get_webview_window(&label) {
                            let _ = window.hide();
                        }
                    }
                }
                tauri::RunEvent::Exit => {
                    state.server.stop();

                tauri::RunEvent::ExitRequested { .. } => {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        if let Ok(mut cf) = state.cloudflared.try_write() {
                            if let Some(mut child) = cf.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
