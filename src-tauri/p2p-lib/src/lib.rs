use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{broadcast, mpsc, RwLock};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;

const LAN_MULTICAST_ADDR: &str = "239.255.43.21";
const LAN_MULTICAST_PORT: u16 = 8002;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PPeerInfo {
    pub peer_id: String,
    pub public_key: String,
    pub address: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PConfig {
    pub listen_port: u16,
    pub max_peers: usize,
    pub relay_enabled: bool,
}

impl Default for P2PConfig {
    fn default() -> Self {
        Self {
            listen_port: 0,
            max_peers: 50,
            relay_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum P2PMessage {
    Hello {
        peer_id: String,
        public_key: String,
        signing_public_key: String,
    },
    Relay {
        from: String,
        to: String,
        payload: String,
    },
    Direct {
        from: String,
        payload: String,
    },
    Discovery {
        peer_id: String,
        public_key: String,
        port: u16,
    },
    FileStart {
        from: String,
        file_id: String,
        file_name: String,
        file_size: u64,
        mime_type: String,
    },
    FileChunk {
        from: String,
        file_id: String,
        offset: u64,
        data: String,
    },
    FileEnd {
        from: String,
        file_id: String,
    },
    /// Group message: sender broadcasts to all peers in the mesh.
    /// Each peer deduplicates by msg_id and forwards to its other peers.
    GroupDirect {
        from: String,
        group_id: String,
        msg_id: String,
        payload: String,
    },
    /// WebRTC call signaling: offer/answer/candidate/hangup.
    CallOffer {
        from: String,
        call_id: String,
        sdp: String,
    },
    CallAnswer {
        from: String,
        call_id: String,
        sdp: String,
    },
    CallCandidate {
        from: String,
        call_id: String,
        candidate: String,
    },
    CallHangup {
        from: String,
        call_id: String,
    },
    /// Reaction to a message: add or remove emoji.
    Reaction {
        from: String,
        msg_id: String,
        emoji: String,
        add: bool,
    },
    /// Typing indicator.
    Typing {
        from: String,
        chat_id: String,
        is_typing: bool,
    },
    /// Online status ping.
    OnlineStatus {
        from: String,
        is_online: bool,
    },
    Ack { ok: bool },
}

struct PeerWriter {
    tx: mpsc::Sender<String>,
}

pub struct P2PNode {
    peers: Arc<RwLock<HashMap<String, P2PPeerInfo>>>,
    writers: Arc<RwLock<HashMap<String, PeerWriter>>>,
    tx: broadcast::Sender<String>,
    config: P2PConfig,
    listener_port: Arc<RwLock<u16>>,
    self_peer_id: Arc<RwLock<Option<String>>>,
    seen_messages: Arc<RwLock<HashMap<String, Instant>>>,
}

impl P2PNode {
    pub fn new(config: P2PConfig) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            writers: Arc::new(RwLock::new(HashMap::new())),
            tx,
            config,
            listener_port: Arc::new(RwLock::new(0)),
            self_peer_id: Arc::new(RwLock::new(None)),
            seen_messages: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start(&self) -> Result<u16, String> {
        let addr = format!("0.0.0.0:{}", self.config.listen_port);
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        *self.listener_port.write().await = port;

        let peers = self.peers.clone();
        let writers = self.writers.clone();
        let tx = self.tx.clone();
        let max_peers = self.config.max_peers;
        let relay_enabled = self.config.relay_enabled;
        let seen_messages = self.seen_messages.clone();
        let self_peer_id = self.self_peer_id.clone();

        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, addr)) => {
                        println!("[P2P] New connection from {}", addr);
                        let peers = peers.clone();
                        let writers = writers.clone();
                        let tx = tx.clone();
                        let seen_messages = seen_messages.clone();
                        let self_peer_id = self_peer_id.clone();
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_connection(stream, peers, writers, tx, max_peers, relay_enabled, seen_messages, self_peer_id).await {
                                eprintln!("[P2P] Connection error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[P2P] Accept error: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    }
                }
            }
        });

        println!("[P2P] Listening on port {}", port);
        Ok(port)
    }

    pub async fn start_lan_discovery(&self) -> Result<(), String> {
        use std::net::Ipv4Addr;
        
        let socket = UdpSocket::bind(format!("0.0.0.0:{}", LAN_MULTICAST_PORT))
            .await
            .map_err(|e| format!("Failed to bind UDP: {}", e))?;
        
        let multicast_addr: Ipv4Addr = LAN_MULTICAST_ADDR.parse().unwrap();
        let interface_addr: Ipv4Addr = "0.0.0.0".parse().unwrap();
        socket.join_multicast_v4(multicast_addr, interface_addr)
            .map_err(|e| format!("Failed to join multicast: {}", e))?;

        let peers = self.peers.clone();
        let self_port = self.get_port().await;
        let self_peer_id = self.get_self_peer_id().await.unwrap_or_default();
        let socket = Arc::new(socket);

        // Broadcast our presence periodically and listen for peers
        let socket_send = socket.clone();
        let peers_send = peers.clone();
        tokio::spawn(async move {
            let discovery_msg = P2PMessage::Discovery {
                peer_id: self_peer_id,
                public_key: String::new(),
                port: self_port,
            };
            let json = serde_json::to_string(&discovery_msg).unwrap_or_default();
            let multicast_str = format!("{}:{}", LAN_MULTICAST_ADDR, LAN_MULTICAST_PORT);
            
            loop {
                // Send broadcast
                if let Err(e) = socket_send.send_to(json.as_bytes(), &multicast_str).await {
                    eprintln!("[P2P] LAN broadcast error: {}", e);
                }
                
                // Listen for responses (non-blocking check)
                let mut buf = [0u8; 4096];
                loop {
                    match socket_send.recv_from(&mut buf).await {
                        Ok((len, _addr)) => {
                            if let Ok(msg) = serde_json::from_slice::<P2PMessage>(&buf[..len]) {
                                match msg {
                                    P2PMessage::Discovery { peer_id, public_key, port } => {
                                        let info = P2PPeerInfo {
                                            peer_id: peer_id.clone(),
                                            public_key,
                                            address: "0.0.0.0".to_string(),
                                            port,
                                        };
                                        peers_send.write().await.insert(peer_id.clone(), info);
                                        println!("[P2P] LAN peer discovered: {}", peer_id);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Err(_) => break, // No more data, wait before next broadcast
                    }
                }
                
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        });

        Ok(())
    }

    async fn handle_connection(
        stream: TcpStream,
        peers: Arc<RwLock<HashMap<String, P2PPeerInfo>>>,
        writers: Arc<RwLock<HashMap<String, PeerWriter>>>,
        tx: broadcast::Sender<String>,
        max_peers: usize,
        relay_enabled: bool,
        seen_messages: Arc<RwLock<HashMap<String, Instant>>>,
        self_peer_id: Arc<RwLock<Option<String>>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (reader, mut writer) = stream.into_split();
        let mut lines = BufReader::new(reader).lines();
        let mut peer_id: Option<String> = None;
        let (write_tx, mut write_rx) = mpsc::channel::<String>(64);

        tokio::spawn(async move {
            while let Some(msg) = write_rx.recv().await {
                if let Err(e) = writer.write_all(msg.as_bytes()).await {
                    eprintln!("[P2P] Write error: {}", e);
                    break;
                }
                if let Err(e) = writer.write_all(b"\n").await {
                    eprintln!("[P2P] Write error: {}", e);
                    break;
                }
            }
        });

        while let Some(line) = lines.next_line().await? {
            if line.is_empty() {
                continue;
            }

            let msg: P2PMessage = match serde_json::from_str(&line) {
                Ok(m) => m,
                Err(_) => continue,
            };

            match msg {
                P2PMessage::Hello { peer_id: pid, public_key, signing_public_key: _ } => {
                    let current_peers = peers.read().await;
                    if current_peers.len() >= max_peers {
                        let ack = P2PMessage::Ack { ok: false };
                        let ack_json = serde_json::to_string(&ack)?;
                        let _ = write_tx.send(format!("{}\n", ack_json)).await;
                        break;
                    }
                    drop(current_peers);

                    let info = P2PPeerInfo {
                        peer_id: pid.clone(),
                        public_key,
                        address: "0.0.0.0".to_string(),
                        port: 0,
                    };
                    peers.write().await.insert(pid.clone(), info);
                    writers.write().await.insert(pid.clone(), PeerWriter { tx: write_tx.clone() });
                    peer_id = Some(pid.clone());

                    let ack = P2PMessage::Ack { ok: true };
                    let ack_json = serde_json::to_string(&ack)?;
                    let _ = write_tx.send(format!("{}\n", ack_json)).await;
                    println!("[P2P] Peer connected: {}", pid);
                }
                P2PMessage::Relay { from, to, payload } => {
                    if !relay_enabled {
                        continue;
                    }
                    let current_peers = peers.read().await;
                    if current_peers.contains_key(&to) {
                        drop(current_peers);
                        let writers = writers.read().await;
                        if let Some(writer) = writers.get(&to) {
                            let relay_msg = P2PMessage::Relay { from, to, payload };
                            let json = serde_json::to_string(&relay_msg)?;
                            let _ = writer.tx.send(json).await;
                        }
                    }
                }
                P2PMessage::Direct { from, payload } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-direct",
                        "from": from,
                        "payload": payload,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::Discovery { peer_id: pid, public_key, port } => {
                    let info = P2PPeerInfo {
                        peer_id: pid.clone(),
                        public_key,
                        address: "0.0.0.0".to_string(),
                        port,
                    };
                    peers.write().await.insert(pid.clone(), info);
                    println!("[P2P] LAN peer discovered: {}", pid);
                }
                P2PMessage::FileStart { from, file_id, file_name, file_size, mime_type } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-file-start",
                        "from": from,
                        "file_id": file_id,
                        "file_name": file_name,
                        "file_size": file_size,
                        "mime_type": mime_type,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::FileChunk { from, file_id, offset, data } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-file-chunk",
                        "from": from,
                        "file_id": file_id,
                        "offset": offset,
                        "data": data,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::FileEnd { from, file_id } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-file-end",
                        "from": from,
                        "file_id": file_id,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::GroupDirect { from, group_id, msg_id, payload } => {
                    // Deduplication: skip if already seen
                    {
                        let mut seen = seen_messages.write().await;
                        // Cleanup expired entries (>60s)
                        let now = Instant::now();
                        seen.retain(|_, ts| now.duration_since(*ts).as_secs() < 60);
                        // Check and insert
                        if seen.contains_key(&msg_id) {
                            continue;
                        }
                        seen.insert(msg_id.clone(), now);
                    }

                    // Broadcast to frontend
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-group-direct",
                        "from": from,
                        "group_id": group_id,
                        "msg_id": msg_id,
                        "payload": payload,
                    }))?;
                    let _ = tx.send(app_msg);

                    // Forward to all other connected peers (mesh routing)
                    let self_id = self_peer_id.read().await.clone().unwrap_or_default();
                    let writers_snapshot: Vec<(String, mpsc::Sender<String>)> = {
                        let writers_guard = writers.read().await;
                        writers_guard.iter()
                            .filter(|(pid, _)| **pid != from && **pid != self_id)
                            .map(|(pid, w)| (pid.clone(), w.tx.clone()))
                            .collect()
                    };

                    for (_pid, writer_tx) in writers_snapshot {
                        let fwd = P2PMessage::GroupDirect {
                            from: from.clone(),
                            group_id: group_id.clone(),
                            msg_id: msg_id.clone(),
                            payload: payload.clone(),
                        };
                        let fwd_json = serde_json::to_string(&fwd).unwrap_or_default();
                        let _ = writer_tx.send(format!("{}\n", fwd_json)).await;
                    }
                }
                P2PMessage::CallOffer { from, call_id, sdp } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-call-offer",
                        "from": from,
                        "call_id": call_id,
                        "sdp": sdp,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::CallAnswer { from, call_id, sdp } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-call-answer",
                        "from": from,
                        "call_id": call_id,
                        "sdp": sdp,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::CallCandidate { from, call_id, candidate } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-call-candidate",
                        "from": from,
                        "call_id": call_id,
                        "candidate": candidate,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::CallHangup { from, call_id } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-call-hangup",
                        "from": from,
                        "call_id": call_id,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::Reaction { from, msg_id, emoji, add } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-reaction",
                        "from": from,
                        "msg_id": msg_id,
                        "emoji": emoji,
                        "add": add,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::Typing { from, chat_id, is_typing } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-typing",
                        "from": from,
                        "chat_id": chat_id,
                        "is_typing": is_typing,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::OnlineStatus { from, is_online } => {
                    let app_msg = serde_json::to_string(&serde_json::json!({
                        "type": "p2p-online-status",
                        "from": from,
                        "is_online": is_online,
                    }))?;
                    let _ = tx.send(app_msg);
                }
                P2PMessage::Ack { .. } => {}
            }
        }

        if let Some(pid) = peer_id {
            peers.write().await.remove(&pid);
            writers.write().await.remove(&pid);
            println!("[P2P] Peer disconnected: {}", pid);
        }

        Ok(())
    }

    pub async fn send_to_peer(&self, target: &str, msg: &str) -> Result<(), String> {
        // Try direct connection first via existing writer
        let writers = self.writers.read().await;
        if let Some(writer) = writers.get(target) {
            let direct_msg = P2PMessage::Direct {
                from: self.get_self_peer_id().await.unwrap_or_default(),
                payload: msg.to_string(),
            };
            let json = serde_json::to_string(&direct_msg).map_err(|e| e.to_string())?;
            if writer.tx.send(format!("{}\n", json)).await.is_ok() {
                return Ok(());
            }
        }
        drop(writers);
        
        // Try to connect directly if we know the address
        let should_try_direct = {
            let peers = self.peers.read().await;
            peers.get(target).map(|p| p.port > 0).unwrap_or(false)
        };
        
        if should_try_direct {
            let addr = {
                let peers = self.peers.read().await;
                peers.get(target).map(|p| format!("{}:{}", p.address, p.port))
            };
            
            if let Some(addr) = addr {
                if let Ok(mut stream) = TcpStream::connect(&addr).await {
                    let hello = P2PMessage::Hello {
                        peer_id: self.get_self_peer_id().await.unwrap_or_default(),
                        public_key: String::new(),
                        signing_public_key: String::new(),
                    };
                    let hello_json = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
                    stream.write_all(hello_json.as_bytes()).await.map_err(|e| e.to_string())?;
                    stream.write_all(b"\n").await.map_err(|e| e.to_string())?;
                    
                    let direct_msg = P2PMessage::Direct {
                        from: self.get_self_peer_id().await.unwrap_or_default(),
                        payload: msg.to_string(),
                    };
                    let json = serde_json::to_string(&direct_msg).map_err(|e| e.to_string())?;
                    stream.write_all(json.as_bytes()).await.map_err(|e| e.to_string())?;
                    stream.write_all(b"\n").await.map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
        
        // Fall back to relay
        self.relay_message(target, msg).await
    }

    async fn relay_message(&self, target: &str, msg: &str) -> Result<(), String> {
        let writers = self.writers.read().await;
        for (pid, writer) in writers.iter() {
            if pid != target {
                let relay_msg = P2PMessage::Relay {
                    from: self.get_self_peer_id().await.unwrap_or_default(),
                    to: target.to_string(),
                    payload: msg.to_string(),
                };
                let json = serde_json::to_string(&relay_msg).map_err(|e| e.to_string())?;
                let _ = writer.tx.send(format!("{}\n", json)).await;
                return Ok(());
            }
        }
        Err("No relay peer available".to_string())
    }

    /// Send a file to a peer in chunks via TCP.
    /// Reads the file, splits into 64KB chunks, base64-encodes, and sends
    /// FileStart → FileChunk* → FileEnd messages.
    pub async fn send_file(
        &self,
        target: &str,
        file_id: &str,
        file_name: &str,
        file_data: &[u8],
        mime_type: &str,
    ) -> Result<(), String> {
        let from = self.get_self_peer_id().await.unwrap_or_default();
        let file_size = file_data.len() as u64;

        // Send FileStart
        let start = P2PMessage::FileStart {
            from: from.clone(),
            file_id: file_id.to_string(),
            file_name: file_name.to_string(),
            file_size,
            mime_type: mime_type.to_string(),
        };
        self.send_raw(target, &start).await?;

        // Send chunks (64KB each)
        const CHUNK_SIZE: usize = 65536;
        let mut offset = 0u64;
        for chunk in file_data.chunks(CHUNK_SIZE) {
            let encoded = BASE64.encode(chunk);
            let chunk_msg = P2PMessage::FileChunk {
                from: from.clone(),
                file_id: file_id.to_string(),
                offset,
                data: encoded,
            };
            self.send_raw(target, &chunk_msg).await?;
            offset += chunk.len() as u64;
        }

        // Send FileEnd
        let end = P2PMessage::FileEnd {
            from: from.clone(),
            file_id: file_id.to_string(),
        };
        self.send_raw(target, &end).await?;

        Ok(())
    }

    /// Send a group message to all connected peers via TCP.
    /// Each peer will forward to its own peers (mesh routing) with dedup.
    pub async fn send_group(
        &self,
        group_id: &str,
        msg_id: &str,
        payload: &str,
    ) -> Result<(), String> {
        let from = self.get_self_peer_id().await.unwrap_or_default();

        let msg = P2PMessage::GroupDirect {
            from: from.clone(),
            group_id: group_id.to_string(),
            msg_id: msg_id.to_string(),
            payload: payload.to_string(),
        };

        // Send to all connected peers
        let writers_snapshot: Vec<(String, mpsc::Sender<String>)> = {
            let writers = self.writers.read().await;
            writers.iter()
                .map(|(pid, w)| (pid.clone(), w.tx.clone()))
                .collect()
        };

        let mut sent = 0;
        for (_pid, writer_tx) in writers_snapshot {
            let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
            if writer_tx.send(format!("{}\n", json)).await.is_ok() {
                sent += 1;
            }
        }

        if sent == 0 {
            return Err("No connected peers for group message".to_string());
        }

        Ok(())
    }

    /// Send a raw P2PMessage to a target peer via existing writer, direct TCP, or relay.
    async fn send_raw(&self, target: &str, msg: &P2PMessage) -> Result<(), String> {
        let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;

        // Try existing writer
        {
            let writers = self.writers.read().await;
            if let Some(writer) = writers.get(target) {
                if writer.tx.send(format!("{}\n", json)).await.is_ok() {
                    return Ok(());
                }
            }
        }

        // Try direct TCP connection if we know the address
        let should_try_direct = {
            let peers = self.peers.read().await;
            peers.get(target).map(|p| p.port > 0).unwrap_or(false)
        };

        if should_try_direct {
            let addr = {
                let peers = self.peers.read().await;
                peers.get(target).map(|p| format!("{}:{}", p.address, p.port))
            };

            if let Some(addr) = addr {
                if let Ok(mut stream) = TcpStream::connect(&addr).await {
                    let hello = P2PMessage::Hello {
                        peer_id: self.get_self_peer_id().await.unwrap_or_default(),
                        public_key: String::new(),
                        signing_public_key: String::new(),
                    };
                    let hello_json = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
                    let _ = stream.write_all(hello_json.as_bytes()).await;
                    let _ = stream.write_all(b"\n").await;

                    let _ = stream.write_all(json.as_bytes()).await;
                    let _ = stream.write_all(b"\n").await;
                    return Ok(());
                }
            }
        }

        // Fallback: try relay
        self.relay_message(target, &json).await
    }

    /// Send any P2PMessage to a target peer (for signaling, etc).
    pub async fn send_to_peer_raw(&self, target: &str, msg: &P2PMessage) -> Result<(), String> {
        self.send_raw(target, msg).await
    }

    pub async fn get_port(&self) -> u16 {
        *self.listener_port.read().await
    }

    pub async fn set_self_peer_id(&self, peer_id: String) {
        *self.self_peer_id.write().await = Some(peer_id);
    }

    pub async fn get_self_peer_id(&self) -> Option<String> {
        self.self_peer_id.read().await.clone()
    }

    pub async fn add_peer(&self, peer: P2PPeerInfo) {
        let mut peers = self.peers.write().await;
        if peers.len() < self.config.max_peers {
            peers.insert(peer.peer_id.clone(), peer);
        }
    }

    pub async fn remove_peer(&self, peer_id: &str) {
        let mut peers = self.peers.write().await;
        peers.remove(peer_id);
    }

    pub async fn get_peers(&self) -> Vec<P2PPeerInfo> {
        let peers = self.peers.read().await;
        peers.values().cloned().collect()
    }

    pub async fn get_peer_count(&self) -> usize {
        let peers = self.peers.read().await;
        peers.len()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_p2p_node_creation() {
        let config = P2PConfig {
            listen_port: 0,
            max_peers: 10,
            relay_enabled: true,
        };
        let node = P2PNode::new(config);
        assert_eq!(node.get_peer_count().await, 0);
    }

    #[tokio::test]
    async fn test_p2p_add_remove_peer() {
        let config = P2PConfig::default();
        let node = P2PNode::new(config);

        let peer = P2PPeerInfo {
            peer_id: "peer_1".to_string(),
            public_key: "abc123".to_string(),
            address: "127.0.0.1".to_string(),
            port: 9000,
        };

        node.add_peer(peer.clone()).await;
        assert_eq!(node.get_peer_count().await, 1);

        node.remove_peer("peer_1").await;
        assert_eq!(node.get_peer_count().await, 0);
    }

    #[tokio::test]
    async fn test_p2p_max_peers() {
        let config = P2PConfig {
            listen_port: 0,
            max_peers: 2,
            relay_enabled: false,
        };
        let node = P2PNode::new(config);

        for i in 0..5 {
            node.add_peer(P2PPeerInfo {
                peer_id: format!("peer_{}", i),
                public_key: "key".to_string(),
                address: "127.0.0.1".to_string(),
                port: 9000 + i as u16,
            }).await;
        }

        assert_eq!(node.get_peer_count().await, 2);
    }

    #[tokio::test]
    async fn test_p2p_start_listener() {
        let config = P2PConfig::default();
        let node = P2PNode::new(config);
        let port = node.start().await.unwrap();
        assert!(port > 0);
    }

    #[tokio::test]
    async fn test_p2p_two_nodes_connect() {
        let config1 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };
        let config2 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };
        
        let node1 = P2PNode::new(config1);
        let node2 = P2PNode::new(config2);
        
        let port1 = node1.start().await.unwrap();
        let port2 = node2.start().await.unwrap();
        
        assert!(port1 > 0);
        assert!(port2 > 0);
        assert_ne!(port1, port2);
        
        // Node2 connects to Node1 via TCP
        let addr = format!("127.0.0.1:{}", port1);
        let mut stream = TcpStream::connect(&addr).await.unwrap();
        
        // Send Hello message
        let hello = P2PMessage::Hello {
            peer_id: "node2".to_string(),
            public_key: "pubkey_node2".to_string(),
            signing_public_key: "signing_node2".to_string(),
        };
        let hello_json = serde_json::to_string(&hello).unwrap();
        stream.write_all(hello_json.as_bytes()).await.unwrap();
        stream.write_all(b"\n").await.unwrap();
        
        // Read response (keep the write half alive so the connection stays open)
        let (reader, mut _writer) = stream.into_split();
        let mut lines = BufReader::new(reader).lines();
        let response = lines.next_line().await.unwrap().unwrap();
        let ack: P2PMessage = serde_json::from_str(&response).unwrap();
        
        match ack {
            P2PMessage::Ack { ok } => assert!(ok),
            _ => panic!("Expected Ack"),
        }
        
        // Node1 should have node2 as peer while the connection is open
        assert_eq!(node1.get_peer_count().await, 1);
        let _ = _writer;
    }

    #[tokio::test]
    async fn test_p2p_message_exchange() {
        let config1 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };
        let config2 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };

        let node1 = P2PNode::new(config1);
        let node2 = P2PNode::new(config2);
        node1.set_self_peer_id("node1".to_string()).await;
        node2.set_self_peer_id("node2".to_string()).await;

        let _port1 = node1.start().await.unwrap();
        let port2 = node2.start().await.unwrap();

        // node2 subscribes to inbound broadcasts
        let mut rx = node2.subscribe();

        // node1 registers node2 and sends a message over TCP
        node1.add_peer(P2PPeerInfo {
            peer_id: "node2".to_string(),
            public_key: "pk2".to_string(),
            address: "127.0.0.1".to_string(),
            port: port2,
        }).await;

        node1.send_to_peer("node2", "hello p2p").await.unwrap();

        // node2 should receive the message within a timeout
        let msg = tokio::time::timeout(
            tokio::time::Duration::from_secs(2),
            rx.recv(),
        ).await.expect("timed out waiting for message").expect("channel closed");

        assert!(msg.contains("hello p2p"), "unexpected msg: {}", msg);
    }

    #[tokio::test]
    async fn test_p2p_file_transfer() {
        let config1 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };
        let config2 = P2PConfig { listen_port: 0, max_peers: 10, relay_enabled: true };

        let node1 = P2PNode::new(config1);
        let node2 = P2PNode::new(config2);
        node1.set_self_peer_id("node1".to_string()).await;
        node2.set_self_peer_id("node2".to_string()).await;

        let _port1 = node1.start().await.unwrap();
        let port2 = node2.start().await.unwrap();

        let mut rx = node2.subscribe();

        node1.add_peer(P2PPeerInfo {
            peer_id: "node2".to_string(),
            public_key: "pk2".to_string(),
            address: "127.0.0.1".to_string(),
            port: port2,
        }).await;

        // Send a small file (200 bytes)
        let file_data = vec![0xABu8; 200];
        node1.send_file("node2", "file_001", "test.bin", &file_data, "application/octet-stream").await.unwrap();

        // Should receive 3 messages: FileStart, FileChunk, FileEnd
        let mut received_start = false;
        let mut received_chunk = false;
        let mut received_end = false;

        for _ in 0..3 {
            let msg = tokio::time::timeout(
                tokio::time::Duration::from_secs(2),
                rx.recv(),
            ).await.expect("timed out waiting for file message").expect("channel closed");

            if msg.contains("p2p-file-start") {
                received_start = true;
                assert!(msg.contains("file_001"));
                assert!(msg.contains("test.bin"));
                assert!(msg.contains("application/octet-stream"));
            } else if msg.contains("p2p-file-chunk") {
                received_chunk = true;
                assert!(msg.contains("file_001"));
                // Verify base64 decodes to original data
                let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
                let encoded = parsed["data"].as_str().unwrap();
                let decoded = BASE64.decode(encoded).unwrap();
                assert_eq!(decoded, file_data);
            } else if msg.contains("p2p-file-end") {
                received_end = true;
                assert!(msg.contains("file_001"));
            }
        }

        assert!(received_start, "missing FileStart");
        assert!(received_chunk, "missing FileChunk");
        assert!(received_end, "missing FileEnd");
    }
}
