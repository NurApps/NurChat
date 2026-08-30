use std::net::SocketAddr;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use serde::{Deserialize, Serialize};
use hmac::{Hmac, Mac};
use sha1::Sha1;

use crate::nat::NatInfo;

const TURN_METHOD_ALLOCATE: u16 = 0x0003;
const TURN_METHOD_CREATE_PERMISSION: u16 = 0x0008;
const TURN_METHOD_CONNECT: u16 = 0x000A;

const TURN_CLASS_REQUEST: u16 = 0x0000;
const TURN_CLASS_SUCCESS: u16 = 0x0100;
const TURN_CLASS_ERROR: u16 = 0x0110;

const TURN_ATTR_USERNAME: u16 = 0x0006;
const TURN_ATTR_MESSAGE_INTEGRITY: u16 = 0x0008;
const TURN_ATTR_NONCE: u16 = 0x0015;
const TURN_ATTR_REALM: u16 = 0x0014;
const TURN_ATTR_XOR_RELAYED_ADDRESS: u16 = 0x0016;
const TURN_ATTR_LIFETIME: u16 = 0x000D;
const TURN_ATTR_XOR_PEER_ADDRESS: u16 = 0x0012;
const TURN_ATTR_REQUESTED_TRANSPORT: u16 = 0x0019;

const MAGIC_COOKIE: u32 = 0x2112A442;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerEndpoint {
    pub peer_id: String,
    pub public_ip: String,
    pub public_port: u16,
    pub nat_type: String,
}

pub struct HolePuncher {
    stun_servers: Vec<String>,
    turn_servers: Vec<TurnServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnServer {
    pub url: String,
    pub username: String,
    pub credential: String,
}

pub struct PunchedConnection {
    pub stream: TcpStream,
    pub peer_id: String,
    pub method: ConnectionMethod,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionMethod {
    Direct,
    HolePunch,
    TurnRelay,
}

/// Represents an allocated TURN relay address
pub struct TurnAllocation {
    pub relayed_addr: SocketAddr,
    pub lifetime: u32,
    pub nonce: String,
    pub realm: String,
}

impl HolePuncher {
    pub fn new(stun_servers: Vec<String>, turn_servers: Vec<TurnServer>) -> Self {
        HolePuncher {
            stun_servers,
            turn_servers,
        }
    }

    pub async fn get_nat_info(&self) -> Result<NatInfo, String> {
        let servers: Vec<&str> = self.stun_servers.iter().map(|s| s.as_str()).collect();
        crate::nat::detect_nat(&servers).await
    }

    pub async fn punch_tcp(
        &self,
        local_port: u16,
        remote: &PeerEndpoint,
    ) -> Result<TcpStream, String> {
        let remote_addr: SocketAddr = format!("{}:{}", remote.public_ip, remote.public_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        let bind_addr: SocketAddr = format!("0.0.0.0:{}", local_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        let socket = tokio::net::TcpSocket::new_v4()
            .map_err(|e| format!("Failed to create socket: {}", e))?;
        socket.set_reuseaddr(true).ok();
        #[cfg(unix)]
        socket.set_reuseport(true).ok();

        socket
            .bind(bind_addr)
            .map_err(|e| format!("Failed to bind socket: {}", e))?;

        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            socket.connect(remote_addr),
        )
        .await
        .map_err(|_| "Hole punch timed out".to_string())?
        .map_err(|e| format!("Hole punch connect failed: {}", e))?;

        Ok(stream)
    }

    pub async fn try_direct_connect(
        &self,
        remote: &PeerEndpoint,
        timeout_ms: u64,
    ) -> Result<TcpStream, String> {
        let addr: SocketAddr = format!("{}:{}", remote.public_ip, remote.public_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        let stream = tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms),
            TcpStream::connect(addr),
        )
        .await
        .map_err(|_| "Connection timed out".to_string())?
        .map_err(|e| format!("Direct connect failed: {}", e))?;

        Ok(stream)
    }

    pub async fn try_turn_relay(
        &self,
        remote: &PeerEndpoint,
    ) -> Result<TcpStream, String> {
        if self.turn_servers.is_empty() {
            return Err("No TURN servers configured".to_string());
        }

        for turn in &self.turn_servers {
            match self.connect_via_turn(turn, remote).await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    eprintln!("[TURN] Failed with {}: {}", turn.url, e);
                    continue;
                }
            }
        }

        Err("All TURN servers failed".to_string())
    }

    /// Try direct → hole punch → TURN relay with fallback
    pub async fn connect_with_fallback(
        &self,
        local_port: u16,
        remote: &PeerEndpoint,
    ) -> Result<PunchedConnection, String> {
        // 1. Try direct connect
        match self.try_direct_connect(remote, 3000).await {
            Ok(stream) => {
                return Ok(PunchedConnection {
                    stream,
                    peer_id: remote.peer_id.clone(),
                    method: ConnectionMethod::Direct,
                });
            }
            Err(e) => eprintln!("[P2P] Direct failed: {}", e),
        }

        // 2. Try hole punch
        match self.punch_tcp(local_port, remote).await {
            Ok(stream) => {
                return Ok(PunchedConnection {
                    stream,
                    peer_id: remote.peer_id.clone(),
                    method: ConnectionMethod::HolePunch,
                });
            }
            Err(e) => eprintln!("[P2P] Hole punch failed: {}", e),
        }

        // 3. Fallback to TURN relay
        match self.try_turn_relay(remote).await {
            Ok(stream) => {
                return Ok(PunchedConnection {
                    stream,
                    peer_id: remote.peer_id.clone(),
                    method: ConnectionMethod::TurnRelay,
                });
            }
            Err(e) => eprintln!("[P2P] TURN relay failed: {}", e),
        }

        Err("All connection methods failed".to_string())
    }

    /// Full TURN relay connection via RFC 5766:
    /// 1. Allocate relay address
    /// 2. Create permission for peer
    /// 3. Connect to peer through relay
    async fn connect_via_turn(
        &self,
        turn: &TurnServer,
        remote: &PeerEndpoint,
    ) -> Result<TcpStream, String> {
        let turn_addr: SocketAddr = turn.url
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        // Step 1: Connect to TURN server
        let mut stream = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            TcpStream::connect(turn_addr),
        )
        .await
        .map_err(|_| "TURN connection timed out".to_string())?
        .map_err(|e| format!("TURN connect failed: {}", e))?;

        // Step 2: Allocate relay address
        let allocation = self.allocate_relay(&mut stream, turn).await?;

        // Step 3: Create permission for peer
        self.create_permission(&mut stream, turn, &allocation, remote).await?;

        // Step 4: Connect to peer through relay
        self.connect_peer_through_relay(&mut stream, turn, &allocation, remote).await?;

        Ok(stream)
    }

    /// Send TURN Allocate request (RFC 5766 Section 6)
    async fn allocate_relay(
        &self,
        stream: &mut TcpStream,
        turn: &TurnServer,
    ) -> Result<TurnAllocation, String> {
        // Build Allocate request
        let mut attrs = Vec::new();

        // REQUESTED-TRANSPORT (RFC 5766 Section 14.7)
        // TCP = 6, UDP = 17
        let mut requested_transport = Vec::new();
        requested_transport.push(0x06); // Protocol: TCP
        requested_transport.push(0x00); // Reserved
        requested_transport.push(0x00);
        requested_transport.push(0x00);
        self.add_attr(&mut attrs, TURN_ATTR_REQUESTED_TRANSPORT, &requested_transport);

        // LIFETIME (default 600 seconds)
        let lifetime: u32 = 600;
        let lifetime_bytes = lifetime.to_be_bytes();
        self.add_attr(&mut attrs, TURN_ATTR_LIFETIME, &lifetime_bytes);

        // Build message (no auth on first attempt)
        let msg = self.build_turn_message(TURN_METHOD_ALLOCATE | TURN_CLASS_REQUEST, &attrs, None, None, None);

        // Send
        stream.write_all(&msg).await
            .map_err(|e| format!("Failed to send Allocate request: {}", e))?;

        // Read response
        let mut buf = vec![0u8; 1500];
        let len = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stream.read(&mut buf),
        )
        .await
        .map_err(|_| "TURN Allocate response timed out".to_string())?
        .map_err(|e| format!("Failed to read Allocate response: {}", e))?;

        // Parse response
        if len < 20 {
            return Err("TURN response too short".to_string());
        }

        let msg_type = u16::from_be_bytes([buf[0], buf[1]]);

        // Handle 401 Unauthorized: extract nonce+realm and retry with MESSAGE-INTEGRITY
        if msg_type & 0x0110 == TURN_CLASS_ERROR {
            let (error_code, _reason) = self.parse_error_response(&buf, len);
            if error_code == 401 {
                // Extract NONCE and REALM from the error response
                let (_, nonce_val, realm_val, _) = self.parse_allocate_response(&buf, len)
                    .map_err(|e| format!("Failed to parse 401 response: {}", e))?;
                let nonce = nonce_val.unwrap_or_default();
                let realm = realm_val.unwrap_or_default();
                if nonce.is_empty() || realm.is_empty() {
                    return Err("TURN 401 missing nonce or realm".to_string());
                }

                // Rebuild attrs and send with auth
                let mut auth_attrs = Vec::new();
                self.add_attr(&mut auth_attrs, TURN_ATTR_REQUESTED_TRANSPORT, &[
                    0x06, 0x00, 0x00, 0x00,
                ]);
                self.add_attr(&mut auth_attrs, TURN_ATTR_LIFETIME, &lifetime_bytes);
                self.add_attr(&mut auth_attrs, TURN_ATTR_NONCE, nonce.as_bytes());
                self.add_attr(&mut auth_attrs, TURN_ATTR_REALM, realm.as_bytes());

                let auth_msg = self.build_turn_message(
                    TURN_METHOD_ALLOCATE | TURN_CLASS_REQUEST,
                    &auth_attrs,
                    Some(&turn.username),
                    Some(&realm),
                    Some(&nonce),
                );

                stream.write_all(&auth_msg).await
                    .map_err(|e| format!("Failed to send authenticated Allocate: {}", e))?;

                let mut buf2 = vec![0u8; 1500];
                let len2 = tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    stream.read(&mut buf2),
                )
                .await
                .map_err(|_| "TURN Allocate response timed out".to_string())?
                .map_err(|e| format!("Failed to read Allocate response: {}", e))?;

                if len2 < 20 {
                    return Err("TURN response too short".to_string());
                }

                let msg_type2 = u16::from_be_bytes([buf2[0], buf2[1]]);
                if msg_type2 & 0x0110 == TURN_CLASS_ERROR {
                    let (code, reason) = self.parse_error_response(&buf2, len2);
                    return Err(format!("TURN Allocate error {}: {}", code, reason));
                }
                if msg_type2 & 0x0100 != TURN_CLASS_SUCCESS {
                    return Err(format!("Unexpected TURN response type: 0x{:04x}", msg_type2));
                }

                let (relay_addr, nonce2, realm2, lifetime_val) = self.parse_allocate_response(&buf2, len2)?;
                return Ok(TurnAllocation {
                    relayed_addr: relay_addr,
                    lifetime: lifetime_val,
                    nonce: nonce2.unwrap_or(nonce),
                    realm: realm2.unwrap_or(realm),
                });
            }
            return Err(format!("TURN Allocate error {}: {}", error_code, _reason));
        }

        if msg_type & 0x0100 != TURN_CLASS_SUCCESS {
            return Err(format!("Unexpected TURN response type: 0x{:04x}", msg_type));
        }

        // Parse attributes
        let (relay_addr, nonce, realm, lifetime_val) = self.parse_allocate_response(&buf, len)?;

        Ok(TurnAllocation {
            relayed_addr: relay_addr,
            lifetime: lifetime_val,
            nonce: nonce.unwrap_or_default(),
            realm: realm.unwrap_or_default(),
        })
    }

    /// Create permission for peer (RFC 5766 Section 7)
    async fn create_permission(
        &self,
        stream: &mut TcpStream,
        _turn: &TurnServer,
        allocation: &TurnAllocation,
        remote: &PeerEndpoint,
    ) -> Result<(), String> {
        let peer_addr: SocketAddr = format!("{}:{}", remote.public_ip, remote.public_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        let mut attrs = Vec::new();

        // XOR-PEER-ADDRESS (RFC 5766 Section 14.3)
        let peer_addr_bytes = self.xor_peer_address(peer_addr, allocation);
        self.add_attr(&mut attrs, TURN_ATTR_XOR_PEER_ADDRESS, &peer_addr_bytes);

        // LIFETIME
        let lifetime: u32 = 600;
        let lifetime_bytes = lifetime.to_be_bytes();
        self.add_attr(&mut attrs, TURN_ATTR_LIFETIME, &lifetime_bytes);

        // Build message
        let msg = self.build_turn_message(TURN_METHOD_CREATE_PERMISSION | TURN_CLASS_REQUEST, &attrs, None, allocation.realm.as_str().into(), allocation.nonce.as_str().into());

        stream.write_all(&msg).await
            .map_err(|e| format!("Failed to send CreatePermission request: {}", e))?;

        // Read response
        let mut buf = vec![0u8; 1500];
        let len = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stream.read(&mut buf),
        )
        .await
        .map_err(|_| "TURN CreatePermission response timed out".to_string())?
        .map_err(|e| format!("Failed to read CreatePermission response: {}", e))?;

        let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
        if msg_type & 0x0100 != TURN_CLASS_SUCCESS {
            let (error_code, reason) = self.parse_error_response(&buf, len);
            return Err(format!("CreatePermission error {}: {}", error_code, reason));
        }

        Ok(())
    }

    /// Connect to peer through TURN relay (RFC 5766 Section 8)
    async fn connect_peer_through_relay(
        &self,
        stream: &mut TcpStream,
        _turn: &TurnServer,
        allocation: &TurnAllocation,
        remote: &PeerEndpoint,
    ) -> Result<(), String> {
        let peer_addr: SocketAddr = format!("{}:{}", remote.public_ip, remote.public_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;

        let mut attrs = Vec::new();

        // XOR-PEER-ADDRESS
        let peer_addr_bytes = self.xor_peer_address(peer_addr, allocation);
        self.add_attr(&mut attrs, TURN_ATTR_XOR_PEER_ADDRESS, &peer_addr_bytes);

        // Build Connect request
        let msg = self.build_turn_message(TURN_METHOD_CONNECT | TURN_CLASS_REQUEST, &attrs, None, allocation.realm.as_str().into(), allocation.nonce.as_str().into());

        stream.write_all(&msg).await
            .map_err(|e| format!("Failed to send Connect request: {}", e))?;

        // Read response
        let mut buf = vec![0u8; 1500];
        let len = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stream.read(&mut buf),
        )
        .await
        .map_err(|_| "TURN Connect response timed out".to_string())?
        .map_err(|e| format!("Failed to read Connect response: {}", e))?;

        let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
        if msg_type & 0x0100 != TURN_CLASS_SUCCESS {
            let (error_code, reason) = self.parse_error_response(&buf, len);
            return Err(format!("Connect error {}: {}", error_code, reason));
        }

        // Channel bound — now relayed data flows through TCP
        Ok(())
    }

    /// Build a TURN message with header and attributes
    fn build_turn_message(&self, msg_type: u16, attrs: &[u8], username: Option<&str>, realm: Option<&str>, nonce: Option<&str>) -> Vec<u8> {
        let mut msg = Vec::new();

        // Header (20 bytes)
        msg.push((msg_type >> 8) as u8);
        msg.push(msg_type as u8);

        // Message length placeholder (will be updated after auth attrs)
        let len = attrs.len() as u16;
        msg.push((len >> 8) as u8);
        msg.push(len as u8);

        // Magic cookie
        msg.push((MAGIC_COOKIE >> 24) as u8);
        msg.push((MAGIC_COOKIE >> 16) as u8);
        msg.push((MAGIC_COOKIE >> 8) as u8);
        msg.push(MAGIC_COOKIE as u8);

        // Transaction ID (12 bytes random)
        let mut tid = [0u8; 12];
        use rand::Rng;
        rand::thread_rng().fill(&mut tid);
        msg.extend_from_slice(&tid);

        // Attributes
        msg.extend_from_slice(attrs);

        // Add USERNAME + MESSAGE-INTEGRITY if credentials provided
        if let (Some(user), Some(realm_val), Some(_nonce_val)) = (username, realm, nonce) {
            let combined = format!("{}:{}", user, realm_val);
            // USERNAME attribute
            let user_bytes = combined.as_bytes();
            msg.push((TURN_ATTR_USERNAME >> 8) as u8);
            msg.push(TURN_ATTR_USERNAME as u8);
            msg.push((user_bytes.len() >> 8) as u8);
            msg.push(user_bytes.len() as u8);
            msg.extend_from_slice(user_bytes);
            let padding = (4 - user_bytes.len() % 4) % 4;
            msg.extend(std::iter::repeat(0).take(padding));

            // MESSAGE-INTEGRITY (placeholder, computed below)
            // Reserve 20 bytes for the HMAC-SHA1 attribute
            msg.push((TURN_ATTR_MESSAGE_INTEGRITY >> 8) as u8);
            msg.push(TURN_ATTR_MESSAGE_INTEGRITY as u8);
            msg.push(0x00);
            msg.push(0x14); // 20 bytes
            msg.extend(std::iter::repeat(0).take(20));

            // Update message length in header
            let body_len = msg.len() - 20; // header is 20 bytes
            msg[2] = (body_len >> 8) as u8;
            msg[3] = body_len as u8;

            // Compute HMAC-SHA1 over the message body (from byte 20 onward)
            let key = format!("{}:{}", user, realm_val);
            let mut mac = Hmac::<Sha1>::new_from_slice(key.as_bytes())
                .expect("HMAC can take key of any size");
            mac.update(&msg[20..]);
            let result = mac.finalize();
            let hmac_bytes = result.into_bytes();

            // Write HMAC into the last 20 bytes before the end
            let hmac_start = msg.len() - 20;
            msg[hmac_start..hmac_start + 20].copy_from_slice(&hmac_bytes);
        }

        msg
    }

    /// Add a TLV attribute to the attributes buffer
    fn add_attr(&self, attrs: &mut Vec<u8>, attr_type: u16, data: &[u8]) {
        attrs.push((attr_type >> 8) as u8);
        attrs.push(attr_type as u8);

        let len = data.len() as u16;
        attrs.push((len >> 8) as u8);
        attrs.push(len as u8);

        attrs.extend_from_slice(data);

        // Pad to 4-byte boundary
        let padding = (4 - data.len() % 4) % 4;
        attrs.extend(std::iter::repeat(0).take(padding));
    }

    /// XOR-PEER-ADDRESS encoding (RFC 5766 Section 14.3)
    fn xor_peer_address(&self, addr: SocketAddr, _allocation: &TurnAllocation) -> Vec<u8> {
        let ip = match addr {
            SocketAddr::V4(v4) => v4.ip().octets(),
            _ => return Vec::new(),
        };

        let port = addr.port();
        let xor_port = port ^ ((MAGIC_COOKIE >> 16) as u16);

        let mut data = Vec::new();
        data.push(0x00); // Reserved
        data.push(0x01); // IPv4 family

        // XOR port
        data.push((xor_port >> 8) as u8);
        data.push(xor_port as u8);

        // XOR IP with magic cookie
        data.push(ip[0] ^ ((MAGIC_COOKIE >> 24) as u8));
        data.push(ip[1] ^ ((MAGIC_COOKIE >> 16) as u8));
        data.push(ip[2] ^ ((MAGIC_COOKIE >> 8) as u8));
        data.push(ip[3] ^ (MAGIC_COOKIE as u8));

        data
    }

    /// Parse Allocate success response attributes
    fn parse_allocate_response(
        &self,
        buf: &[u8],
        _len: usize,
    ) -> Result<(SocketAddr, Option<String>, Option<String>, u32), String> {
        let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        let attrs = &buf[20..20 + msg_len];

        let mut relay_addr = None;
        let mut nonce = None;
        let mut realm = None;
        let mut lifetime: u32 = 600;

        let mut i = 0;
        while i + 4 <= attrs.len() {
            let attr_type = u16::from_be_bytes([attrs[i], attrs[i + 1]]);
            let attr_len = u16::from_be_bytes([attrs[i + 2], attrs[i + 3]]) as usize;

            if i + 4 + attr_len > attrs.len() {
                break;
            }

            let data = &attrs[i + 4..i + 4 + attr_len];

            match attr_type {
                TURN_ATTR_XOR_RELAYED_ADDRESS => {
                    if data.len() >= 8 && data[1] == 0x01 {
                        let xor_port = u16::from_be_bytes([data[2], data[3]]);
                        let port = xor_port ^ ((MAGIC_COOKIE >> 16) as u16);
                        let ip = [
                            data[4] ^ ((MAGIC_COOKIE >> 24) as u8),
                            data[5] ^ ((MAGIC_COOKIE >> 16) as u8),
                            data[6] ^ ((MAGIC_COOKIE >> 8) as u8),
                            data[7] ^ (MAGIC_COOKIE as u8),
                        ];
                        relay_addr = match format!("{}.{}.{}.{}:{}", ip[0], ip[1], ip[2], ip[3], port).parse() {
                            Ok(addr) => Some(addr),
                            Err(e) => {
                                eprintln!("[TURN] Failed to parse relay address: {}", e);
                                None
                            }
                        };
                    }
                }
                TURN_ATTR_NONCE => {
                    nonce = Some(String::from_utf8_lossy(data).to_string());
                }
                TURN_ATTR_REALM => {
                    realm = Some(String::from_utf8_lossy(data).to_string());
                }
                TURN_ATTR_LIFETIME => {
                    if data.len() >= 4 {
                        lifetime = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                    }
                }
                _ => {}
            }

            let padded = attr_len + (4 - attr_len % 4) % 4;
            i += 4 + padded;
        }

        let relay = relay_addr.ok_or("No XOR-RELAYED-ADDRESS in response")?;
        Ok((relay, nonce, realm, lifetime))
    }

    /// Parse error response
    fn parse_error_response(&self, buf: &[u8], _len: usize) -> (u16, String) {
        let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        let attrs = &buf[20..20 + msg_len];

        let mut error_code = 0;
        let mut reason = String::new();

        let mut i = 0;
        while i + 4 <= attrs.len() {
            let attr_type = u16::from_be_bytes([attrs[i], attrs[i + 1]]);
            let attr_len = u16::from_be_bytes([attrs[i + 2], attrs[i + 3]]) as usize;

            if i + 4 + attr_len > attrs.len() {
                break;
            }

            let data = &attrs[i + 4..i + 4 + attr_len];

            // ERROR-CODE (0x0009)
            if attr_type == 0x0009 && data.len() >= 4 {
                error_code = (data[2] as u16) * 100 + (data[3] as u16);
                reason = String::from_utf8_lossy(&data[4..]).to_string();
            }

            let padded = attr_len + (4 - attr_len % 4) % 4;
            i += 4 + padded;
        }

        (error_code, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_endpoint_serialize() {
        let ep = PeerEndpoint {
            peer_id: "test".to_string(),
            public_ip: "8.8.8.8".to_string(),
            public_port: 12345,
            nat_type: "full_cone".to_string(),
        };
        let json = serde_json::to_string(&ep).unwrap();
        assert!(json.contains("8.8.8.8"));
        assert!(json.contains("full_cone"));
    }

    #[test]
    fn test_turn_server_serialize() {
        let ts = TurnServer {
            url: "turn:1.2.3.4:3478".to_string(),
            username: "user".to_string(),
            credential: "pass".to_string(),
        };
        let json = serde_json::to_string(&ts).unwrap();
        assert!(json.contains("turn:1.2.3.4:3478"));
    }

    #[test]
    fn test_connection_method() {
        assert_eq!(ConnectionMethod::Direct, ConnectionMethod::Direct);
        assert_ne!(ConnectionMethod::Direct, ConnectionMethod::TurnRelay);
    }

    #[test]
    fn test_build_turn_message() {
        let puncher = HolePuncher::new(vec![], vec![]);
        let attrs = vec![0x00, 0x01, 0x00, 0x04, 0x01, 0x02, 0x03, 0x04];
        let msg = puncher.build_turn_message(TURN_METHOD_ALLOCATE | TURN_CLASS_REQUEST, &attrs, None, None, None);

        assert_eq!(msg.len(), 20 + attrs.len());
        assert_eq!(msg[0], ((TURN_METHOD_ALLOCATE | TURN_CLASS_REQUEST) >> 8) as u8);
        assert_eq!(msg[1], (TURN_METHOD_ALLOCATE | TURN_CLASS_REQUEST) as u8);
        assert_eq!(u16::from_be_bytes([msg[2], msg[3]]), attrs.len() as u16);

        let magic = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(magic, MAGIC_COOKIE);
    }

    #[test]
    fn test_add_attr() {
        let puncher = HolePuncher::new(vec![], vec![]);
        let mut attrs = Vec::new();
        puncher.add_attr(&mut attrs, 0x0006, b"test");

        assert_eq!(attrs[0], 0x00);
        assert_eq!(attrs[1], 0x06); // USERNAME
        assert_eq!(attrs[2], 0x00);
        assert_eq!(attrs[3], 0x04); // length
        assert_eq!(&attrs[4..8], b"test");
    }
}
