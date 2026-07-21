use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PPeerInfo {
    pub peer_id: String,
    pub public_key: String,
    pub address: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
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

pub struct P2PNode {
    peers: Arc<RwLock<HashMap<String, P2PPeerInfo>>>,
    config: P2PConfig,
}

impl P2PNode {
    pub fn new(config: P2PConfig) -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    pub async fn start(&self) -> Result<u16, String> {
        let addr = format!("127.0.0.1:{}", self.config.listen_port);
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        Ok(port)
    }

    #[allow(dead_code)]
    pub async fn add_peer(&self, peer: P2PPeerInfo) {
        let mut peers = self.peers.write().await;
        if peers.len() < self.config.max_peers {
            peers.insert(peer.peer_id.clone(), peer);
        }
    }

    #[allow(dead_code)]
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
}
