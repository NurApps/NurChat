// Встроенный сервер, трей и cloudflared — только десктоп. На Android/iOS
// приложение — тонкий клиент, релей всегда удалённый.
#[cfg(desktop)]
mod host;
#[cfg(desktop)]
mod server;

#[cfg(desktop)]
use host::{HostManager, HostStatus};
#[cfg(desktop)]
use server::ServerManager;
#[cfg(desktop)]
use tauri::menu::MenuBuilder;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
#[cfg(desktop)]
use tauri::{Emitter, State};

#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
struct AppState {
    host: Arc<HostManager>,
    server: ServerManager,
}

#[tauri::command]
async fn get_local_ip() -> Result<String, String> {
    use std::net::ToSocketAddrs;
    let target = "8.8.8.8:53"
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("no address")?;
    let bind_addr: std::net::SocketAddr = ([0, 0, 0, 0], 0).into();
    let socket = tokio::net::UdpSocket::bind(bind_addr)
        .await
        .map_err(|e| e.to_string())?;
    if socket.connect(target).await.is_ok() {
        if let Ok(local) = socket.local_addr() {
            return Ok(local.ip().to_string());
        }
    }
    Ok("127.0.0.1".to_string())
}

#[cfg(mobile)]
#[tauri::command]
fn open_external(_url: String) -> Result<(), String> {
    Err("Открытие ссылок недоступно на мобильных платформах".to_string())
}

/// Only web/mail links may reach the OS opener. Blocks `file:`, `javascript:`,
/// `ms-msdt:` and friends, plus control characters (newline injection).
#[cfg(desktop)]
fn is_allowed_external_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 || trimmed.chars().any(char::is_control) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

#[cfg(desktop)]
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("Неподдерживаемая ссылка".to_string());
    }
    open::that(url.trim()).map_err(|e| format!("Failed to open link: {e}"))
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

#[cfg(mobile)]
#[tauri::command]
fn share_invite(_uri: String) -> Result<(), String> {
    Err("Недоступно на мобильных платформах".to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn share_invite(uri: String) -> Result<(), String> {
    // Open default mail client with invite URI

    let body = format!("Присоединяйся ко мне в NurChat!\n\nМоя ссылка: {}\n\nУстанови NurChat: https://github.com/NurApps/NurChat_desktop/releases", uri);
    let mailto = format!(
        "mailto:?subject=Приглашение в NurChat&body={}",
        urlencoding(&body)
    );
    open::that(&mailto).map_err(|e| format!("Failed to open mail: {e}"))
}

#[cfg(mobile)]
#[tauri::command]
async fn host_start() -> Result<serde_json::Value, String> {
    Err("Хост-режим недоступен на мобильных платформах".to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn host_stop() -> Result<(), String> {
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn host_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "state": "stopped", "url": null, "error": null }))
}

#[cfg(desktop)]
#[tauri::command]
async fn host_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<HostStatus, String> {
    state.host.start(app.clone());
    Ok(state.host.status().await)
}

#[cfg(desktop)]
#[tauri::command]
async fn host_stop(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.host.stop().await;
    state.host.publish_stopped(&app).await;
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
async fn host_status(state: State<'_, AppState>) -> Result<HostStatus, String> {
    Ok(state.host.status().await)
}

#[cfg(mobile)]
#[tauri::command]
fn host_autostart_get() -> Result<bool, String> {
    Ok(false)
}

#[cfg(desktop)]
#[tauri::command]
fn host_autostart_get(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(host_autostart_enabled(&app))
}

#[cfg(mobile)]
#[tauri::command]
fn host_autostart_set(_enabled: bool) -> Result<(), String> {
    Err("Хост-режим недоступен на мобильных платформах".to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn host_autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut value = host::read_host_config(&app);
    value["autostart"] = serde_json::json!(enabled);
    host::write_host_config(&app, &value)
}

#[cfg(desktop)]
fn host_autostart_enabled(app: &tauri::AppHandle) -> bool {
    host::read_host_config(app)["autostart"]
        .as_bool()
        .unwrap_or(false)
}

#[cfg(mobile)]
#[tauri::command]
fn host_cloudflared_get() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(desktop)]
#[tauri::command]
fn host_cloudflared_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(host::saved_cloudflared_path(&app).map(|path| path.to_string_lossy().into_owned()))
}

#[cfg(mobile)]
#[tauri::command]
fn host_cloudflared_set(_path: Option<String>) -> Result<(), String> {
    Err("Хост-режим недоступен на мобильных платформах".to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn host_cloudflared_set(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let mut value = host::read_host_config(&app);
    match path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        Some(p) => {
            if !std::path::Path::new(&p).is_file() {
                return Err(format!("Файл не найден: {p}"));
            }
            value["cloudflared_path"] = serde_json::Value::String(p);
        }
        None => {
            if let Some(object) = value.as_object_mut() {
                object.remove("cloudflared_path");
            }
        }
    }
    host::write_host_config(&app, &value)
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
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse failed: {e}"))?;

    let tag_name = data["tag_name"].as_str().unwrap_or("").to_string();
    let latest = tag_name.trim_start_matches('v');
    let current = current_version.trim_start_matches('v');

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

#[cfg(desktop)]
fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '\n' => "%0A".to_string(),
            _ if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' || c == '~' => {
                c.to_string()
            }
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn test_external_url_scheme_allowlist() {
        assert!(is_allowed_external_url(
            "https://github.com/NurApps/NurChat"
        ));
        assert!(is_allowed_external_url("http://127.0.0.1:8000/health"));
        assert!(is_allowed_external_url("mailto:?subject=Hi"));
        assert!(is_allowed_external_url("  HTTPS://example.com/x  "));

        assert!(!is_allowed_external_url(
            "file:///C:/Windows/System32/calc.exe"
        ));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("ms-msdt:/id"));
        assert!(!is_allowed_external_url("https://example.com/\ncalc.exe"));
        assert!(!is_allowed_external_url(""));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin: second launch must focus the running instance
    // instead of spawning a second embedded relay/tunnel on the same port.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder.plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder
        .manage(AppState {
            host: Arc::new(HostManager::new()),
            server: ServerManager::new(),
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![
            get_local_ip,
            open_external,
            check_update,
            get_app_version,
            show_main_window,
            minimize_to_tray,
            share_invite,
            host_start,
            host_stop,
            host_status,
            host_autostart_get,
            host_autostart_set,
            host_cloudflared_get,
            host_cloudflared_set,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            setup_desktop(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(desktop)]
            handle_desktop_event(_app_handle, _event);
        });
}

#[cfg(desktop)]
fn handle_desktop_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    let state = app_handle.state::<AppState>();

    match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: win_event,
            ..
        } => {
            if let tauri::WindowEvent::CloseRequested { api, .. } = win_event {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
        }
        tauri::RunEvent::Exit => {
            state.host.kill_now();
            state.server.stop();
        }
        _ => {}
    }
}

#[cfg(desktop)]
fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Auto-start server
    let state = app.handle().state::<AppState>();

    // Use app_data_dir for server files, create if missing
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    if !app_dir.exists() {
        let _ = std::fs::create_dir_all(&app_dir);
    }

    // Also try resource dir for Tauri sidecar
    let res_dir = app.path().resource_dir().ok();

    log::info!("Server app_dir: {:?}", app_dir);
    log::info!("Server resource_dir: {:?}", res_dir);

    // run.bat dev/vite поднимает relay сам (NURCHAT_MANAGED_RELAY=1):
    // встраивать второй сервер не нужно — только ждём готовности :8000.
    // Иначе (двойной клик по .exe) поведение прежнее — autostart.
    if std::env::var("NURCHAT_MANAGED_RELAY").as_deref() == Ok("1") {
        log::info!("NURCHAT_MANAGED_RELAY=1: relay managed externally, skipping autostart");
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            let state = handle.state::<AppState>();
            match state.server.wait_ready(60) {
                Ok(()) => {
                    log::info!("External relay is ready");
                    let _ = handle.emit("server-status", serde_json::json!({"status": "ready"}));
                }
                Err(e) => {
                    log::error!("External relay not ready: {}", e);
                    let _ = handle.emit(
                        "server-status",
                        serde_json::json!({"status": "failed", "error": e}),
                    );
                }
            }
        });
    } else {
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
                            let _ = handle
                                .emit("server-status", serde_json::json!({"status": "ready"}));
                            // Хост-режим переживает рестарт приложения: если
                            // пользователь его включал, туннель поднимается сам.
                            if host_autostart_enabled(&handle) {
                                state.host.start(handle.clone());
                            }
                        }
                        Err(e) => {
                            log::error!("Server failed to start: {}", e);
                            let _ = handle.emit(
                                "server-status",
                                serde_json::json!({"status": "failed", "error": e}),
                            );
                        }
                    }
                });
            }
            Err(e) => {
                log::error!("Failed to start server: {}", e);
                let _ = handle.emit(
                    "server-status",
                    serde_json::json!({"status": "failed", "error": e}),
                );
            }
        }
    }

    // Tray icon

    if !cfg!(debug_assertions) {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
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
    let quit_label = "Закрыть NurChat";

    let tray_menu = MenuBuilder::new(app)
        .item(&tauri::menu::MenuItemBuilder::with_id("show", show_label).build(app)?)
        .item(&tauri::menu::MenuItemBuilder::with_id("quit", quit_label).build(app)?)
        .build()?;

    let mut tray_builder = TrayIconBuilder::new();
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    let _tray = tray_builder
        .menu(&tray_menu)
        .tooltip("NurChat")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                let state = app.state::<AppState>();
                state.host.kill_now();
                state.server.stop();

                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
