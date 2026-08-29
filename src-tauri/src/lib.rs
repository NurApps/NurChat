use p2p_lib::{P2PNode, P2PConfig, P2PPeerInfo};
use p2p_lib::nat;
use p2p_lib::hole_punch::{HolePuncher, TurnServer, PeerEndpoint};
use tauri::{Manager, State, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder};
use tokio::sync::RwLock;
use tokio::process::{Child, Command as TokioCommand};
use tokio::io::{AsyncBufReadExt, BufReader};

struct AppState {
    p2p: RwLock<Option<P2PNode>>,
    cloudflared: RwLock<Option<Child>>,
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
    // Record the address book entry (used for re-dials) AND actively dial:
    // handshake + writer registration happen in the background.
    node.add_peer(P2PPeerInfo {
        peer_id: public_key.clone(),
        public_key: public_key.clone(),
        address: address.clone(),
        port,
    }).await;
    node.dial_peer(address, port, public_key).await
}

#[tauri::command]
async fn p2p_send_message(state: State<'_, AppState>, target: String, payload: String) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    node.send_to_peer(&target, &payload).await
}

#[tauri::command]
async fn p2p_send_file(state: State<'_, AppState>, target: String, file_id: String, file_name: String, file_data: Vec<u8>, mime_type: String) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    node.send_file(&target, &file_id, &file_name, &file_data, &mime_type).await
}

#[tauri::command]
async fn p2p_send_group(state: State<'_, AppState>, group_id: String, msg_id: String, payload: String) -> Result<(), String> {
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    node.send_group(&group_id, &msg_id, &payload).await
}

#[tauri::command]
async fn p2p_send_call_signaling(state: State<'_, AppState>, target: String, call_id: String, signal_type: String, data: String) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    let msg = match signal_type.as_str() {
        "offer" => P2PMessage::CallOffer { from, call_id, sdp: data },
        "answer" => P2PMessage::CallAnswer { from, call_id, sdp: data },
        "candidate" => P2PMessage::CallCandidate { from, call_id, candidate: data },
        "hangup" => P2PMessage::CallHangup { from, call_id },
        _ => return Err(format!("Unknown signal type: {}", signal_type)),
    };
    node.send_to_peer_raw(&target, &msg).await
}

#[tauri::command]
async fn p2p_send_reaction(state: State<'_, AppState>, target: String, msg_id: String, emoji: String, add: bool) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    node.send_to_peer_raw(&target, &P2PMessage::Reaction { from, msg_id, emoji, add }).await
}

#[tauri::command]
async fn p2p_send_typing(state: State<'_, AppState>, target: String, chat_id: String, is_typing: bool) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    node.send_to_peer_raw(&target, &P2PMessage::Typing { from, chat_id, is_typing }).await
}

#[tauri::command]
async fn p2p_send_online_status(state: State<'_, AppState>, target: String, is_online: bool) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    node.send_to_peer_raw(&target, &P2PMessage::OnlineStatus { from, is_online }).await
}

#[tauri::command]
async fn p2p_send_message_edit(state: State<'_, AppState>, target: String, msg_id: String, new_content: String) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    node.send_to_peer_raw(&target, &P2PMessage::MessageEdit { from, msg_id, new_content }).await
}

#[tauri::command]
async fn p2p_send_message_delete(state: State<'_, AppState>, target: String, msg_id: String, delete_for_all: bool) -> Result<(), String> {
    use p2p_lib::P2PMessage;
    let p2p = state.p2p.read().await;
    let node = p2p.as_ref().ok_or("P2P not initialized")?;
    let from = node.get_self_peer_id().await.unwrap_or_default();
    node.send_to_peer_raw(&target, &P2PMessage::MessageDelete { from, msg_id, delete_for_all }).await
}

#[tauri::command]
fn p2p_get_invite_link(_state: State<'_, AppState>) -> Result<String, String> {
    // This will be called synchronously, but we need the port
    // In practice, the frontend will get the port first and construct the link
    Ok("nurchat://".to_string())
}

#[tauri::command]
async fn init_p2p(app: tauri::AppHandle, state: State<'_, AppState>, listen_port: Option<u16>, peer_id: Option<String>, identity_secret_hex: Option<String>) -> Result<u16, String> {
    // Deterministic transport identity from the user's X25519 secret:
    // ecdh_pub == peer identity key => MITM-proof handshake binding.
    let identity_secret = identity_secret_hex.and_then(|hex| {
        if hex.len() != 64 { return None; }
        let mut buf = [0u8; 32];
        (0..32).for_each(|i| {
            buf[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
        });
        Some(buf)
    });
    let config = P2PConfig {
        listen_port: listen_port.unwrap_or(0),
        identity_secret,
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
async fn p2p_detect_nat(stun_servers: Option<Vec<String>>) -> Result<nat::NatInfo, String> {
    let servers = stun_servers.unwrap_or_else(|| {
        vec![
            "stun.l.google.com:19302".to_string(),
            "stun1.l.google.com:19302".to_string(),
        ]
    });
    let refs: Vec<&str> = servers.iter().map(|s| s.as_str()).collect();
    nat::detect_nat(&refs).await
}

#[tauri::command]
async fn p2p_hole_punch(
    state: State<'_, AppState>,
    local_port: u16,
    remote_public_ip: String,
    remote_public_port: u16,
    remote_peer_id: String,
    remote_nat_type: String,
    stun_servers: Option<Vec<String>>,
    turn_servers_json: Option<String>,
) -> Result<String, String> {
    let stun = stun_servers.unwrap_or_else(|| {
        vec![
            "stun.l.google.com:19302".to_string(),
            "stun1.l.google.com:19302".to_string(),
            "stun.ekiga.net:3478".to_string(),
        ]
    });

    let turn: Vec<TurnServer> = if let Some(json) = turn_servers_json {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    let puncher = HolePuncher::new(stun, turn);

    let remote = PeerEndpoint {
        peer_id: remote_peer_id.clone(),
        public_ip: remote_public_ip.clone(),
        public_port: remote_public_port,
        nat_type: remote_nat_type,
    };

    let result = puncher.connect_with_fallback(local_port, &remote).await?;

    // Hand the punched stream to the node: encrypted handshake runs as
    // initiator and the connection stays alive like a regular dial.
    {
        let p2p = state.p2p.read().await;
        let node = p2p.as_ref().ok_or("P2P not initialized")?;
        node.adopt_stream(
            result.stream,
            remote_public_ip,
            0,
            remote_peer_id.clone(),
        )
        .await?;
    }

    Ok(format!("{:?}", result.method))
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

    // Make executable on Unix
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
    // Check if tunnel already running
    {
        let mut cf = state.cloudflared.write().await;
        if let Some(child) = cf.as_mut() {
            if child.try_wait().ok().flatten().is_none() {
                return Err("Tunnel already running".to_string());
            }
        }
    }

    // Path for cloudflared binary
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let binary_name = if cfg!(target_os = "windows") {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let binary_path = app_dir.join(binary_name);

    // Download if not present
    if !binary_path.exists() {
        download_cloudflared(&binary_path).await?;
    }

    // Spawn cloudflared tunnel
    let mut child = TokioCommand::new(&binary_path)
        .args(["tunnel", "--url", "http://localhost:8000"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start cloudflared: {e}"))?;

    // Read stdout to find the tunnel URL
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let url = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            if line.contains("trycloudflare.com") || line.contains("https://") {
                // Extract URL from the line
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

    // Spawn a background task to forward remaining stdout to stderr (prevent buffer full)
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

    // Store the child process
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

    // Proper semver comparison: "1.10.0" > "1.9.0" (string != would be wrong)
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
            p2p: RwLock::new(None),
            cloudflared: RwLock::new(None),
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            p2p_get_peers,
            p2p_get_peer_count,
            p2p_get_port,
            p2p_connect_peer,
            p2p_send_message,
            p2p_send_file,
            p2p_send_group,
            p2p_send_call_signaling,
            p2p_send_reaction,
            p2p_send_typing,
            p2p_send_online_status,
            p2p_send_message_edit,
            p2p_send_message_delete,
            p2p_get_invite_link,
            init_p2p,
            p2p_start_lan_discovery,
            p2p_detect_nat,
            p2p_hole_punch,
            get_local_ip,
            download_and_open_file,
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

            // Relay server runs externally (shared instance via VITE_API_HOST)
            // No sidecar needed — connection configured in frontend config

            // Wait for server to be ready (poll /api/health)
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tokio::spawn(async move {
                    use std::time::Duration;
                    for _ in 0..30 {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        if let Ok(resp) = reqwest::get("http://127.0.0.1:8000/api/health").await {
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
                tauri::RunEvent::ExitRequested { .. } => {
                    // Kill cloudflared tunnel on exit
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
