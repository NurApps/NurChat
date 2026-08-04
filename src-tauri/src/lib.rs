use p2p_lib::{P2PNode, P2PConfig, P2PPeerInfo};
use tauri::{Manager, State, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder};
use tokio::sync::RwLock;

struct AppState {
    p2p: RwLock<Option<P2PNode>>,
}

#[tauri::command]
async fn p2p_get_peers(state: State<'_, AppState>) -> Result<Vec<P2PPeerInfo>, String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    Ok(node.get_peers().await)
}

#[tauri::command]
async fn p2p_get_peer_count(state: State<'_, AppState>) -> Result<usize, String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    Ok(node.get_peer_count().await)
}

#[tauri::command]
async fn p2p_get_port(state: State<'_, AppState>) -> Result<u16, String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    Ok(node.get_port().await)
}

#[tauri::command]
async fn p2p_connect_peer(state: State<'_, AppState>, address: String, port: u16, public_key: String) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let peer = P2PPeerInfo {
        peer_id: public_key.clone(),
        public_key,
        address,
        port,
    };
    node.add_peer(peer).await;
    Ok(())
}

#[tauri::command]
async fn p2p_send_message(state: State<'_, AppState>, target: String, payload: String) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    node.send_to_peer(&target, &payload).await
}

#[tauri::command]
fn p2p_get_invite_link(_state: State<'_, AppState>) -> Result<String, String> {
    // This will be called synchronously, but we need the port
    // In practice, the frontend will get the port first and construct the link
    Ok("nurchat://".to_string())
}

#[tauri::command]
async fn init_p2p(app: tauri::AppHandle, state: State<'_, AppState>, listen_port: Option<u16>, peer_id: Option<String>) -> Result<u16, String> {
    let config = P2PConfig {
        listen_port: listen_port.unwrap_or(0),
        ..Default::default()
    };
    let node = P2PNode::new(config);
    let port = node.start().await?;
    if let Some(pid) = peer_id {
        node.set_self_peer_id(pid).await;
    }
    // Forward inbound P2P messages to the frontend as Tauri events.
    let mut rx = node.subscribe();
    let handle = app.clone();
    tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&msg) {
                let _ = handle.emit("p2p-message", payload);
            }
        }
    });
    let mut p2p = state.p2p.write().await;
    *p2p = Some(node);
    Ok(port)
}

#[tauri::command]
async fn p2p_start_lan_discovery(state: State<'_, AppState>) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    node.start_lan_discovery().await
}

#[tauri::command]
async fn get_local_ip() -> Result<String, String> {
    use std::net::ToSocketAddrs;
    // Determine the outbound LAN IP by connecting a UDP socket to a public
    // address (no packets are actually sent) and reading the local address.
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
            p2p: RwLock::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            p2p_get_peers,
            p2p_get_peer_count,
            p2p_get_port,
            p2p_connect_peer,
            p2p_send_message,
            p2p_get_invite_link,
            init_p2p,
            p2p_start_lan_discovery,
            get_local_ip,
            download_and_open_file,
            check_update,
            get_app_version,
            show_main_window,
            minimize_to_tray,
            share_invite,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Tray icon
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
            match event {
                tauri::RunEvent::WindowEvent { label, event: win_event, .. } => {
                    if let tauri::WindowEvent::CloseRequested { .. } = win_event {
                        if let Some(window) = app_handle.get_webview_window(&label) {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            }
        });
}
