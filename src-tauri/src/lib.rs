mod ipfs;
mod p2p;

use ipfs::{IpfsClient, IpfsAddResult};
use p2p::{P2PNode, P2PConfig, P2PPeerInfo};
use std::path::PathBuf;
use tauri::{Manager, State};
use tokio::sync::RwLock;

struct AppState {
    ipfs: RwLock<Option<IpfsClient>>,
    p2p: RwLock<Option<P2PNode>>,
}

#[tauri::command]
async fn ipfs_add_file(state: State<'_, AppState>, file_path: String) -> Result<IpfsAddResult, String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    client.add_file(&PathBuf::from(file_path)).await
}

#[tauri::command]
async fn ipfs_cat(state: State<'_, AppState>, hash: String) -> Result<Vec<u8>, String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    client.cat(&hash).await
}

#[tauri::command]
async fn ipfs_pin(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    client.pin(&hash).await
}

#[tauri::command]
async fn ipfs_unpin(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    client.unpin(&hash).await
}

#[tauri::command]
async fn ipfs_list_pins(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    client.ls_pins().await
}

#[tauri::command]
async fn ipfs_is_online(state: State<'_, AppState>) -> Result<bool, String> {
    let ipfs = state.ipfs.read().await;
    let client = ipfs.as_ref().ok_or("IPFS not configured")?;
    Ok(client.is_online().await)
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
async fn init_ipfs(state: State<'_, AppState>, api_url: Option<String>) -> Result<bool, String> {
    let url = api_url.unwrap_or_else(|| "http://127.0.0.1:5001".to_string());
    let client = IpfsClient::new(&url);
    let online = client.is_online().await;
    if online {
        let mut ipfs = state.ipfs.write().await;
        *ipfs = Some(client);
    }
    Ok(online)
}

#[tauri::command]
async fn init_p2p(state: State<'_, AppState>, listen_port: Option<u16>) -> Result<u16, String> {
    let config = P2PConfig {
        listen_port: listen_port.unwrap_or(0),
        ..Default::default()
    };
    let node = P2PNode::new(config);
    let port = node.start().await?;
    let mut p2p = state.p2p.write().await;
    *p2p = Some(node);
    Ok(port)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ipfs: RwLock::new(None),
            p2p: RwLock::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            ipfs_add_file,
            ipfs_cat,
            ipfs_pin,
            ipfs_unpin,
            ipfs_list_pins,
            ipfs_is_online,
            init_ipfs,
            p2p_get_peers,
            p2p_get_peer_count,
            init_p2p,
            download_and_open_file,
        ])
        .setup(|app| {
            // Start server sidecar
            let sidecar_command = app.shell().sidecar("nurchat-server").unwrap();
            let (mut _rx, _child) = sidecar_command.spawn().expect("Failed to start server sidecar");

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
