use std::net::{SocketAddr, ToSocketAddrs};
use std::time::Duration;
use tokio::net::UdpSocket;
use rand::Rng;
use serde::{Deserialize, Serialize};

const STUN_METHOD_BINDING: u16 = 0x0001;
const STUN_CLASS_SUCCESS_RESPONSE: u16 = 0x0101;
const MAGIC_COOKIE: u32 = 0x2112A442;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NatType {
    PublicInternet,
    FullCone,
    RestrictedCone,
    PortRestricted,
    Symmetric,
    Unknown,
}

impl std::fmt::Display for NatType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NatType::PublicInternet => write!(f, "public"),
            NatType::FullCone => write!(f, "full_cone"),
            NatType::RestrictedCone => write!(f, "restricted_cone"),
            NatType::PortRestricted => write!(f, "port_restricted"),
            NatType::Symmetric => write!(f, "symmetric"),
            NatType::Unknown => write!(f, "unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatInfo {
    pub nat_type: NatType,
    pub public_ip: String,
    pub public_port: u16,
    pub local_ip: String,
    pub local_port: u16,
}

fn build_stun_request() -> ([u8; 20], [u8; 12]) {
    let mut rng = rand::thread_rng();
    let mut transaction_id = [0u8; 12];
    rng.fill(&mut transaction_id);

    let mut header = [0u8; 20];
    header[0] = (STUN_METHOD_BINDING >> 8) as u8;
    header[1] = STUN_METHOD_BINDING as u8;
    // msg length = 0 (no attributes)
    header[4] = (MAGIC_COOKIE >> 24) as u8;
    header[5] = (MAGIC_COOKIE >> 16) as u8;
    header[6] = (MAGIC_COOKIE >> 8) as u8;
    header[7] = MAGIC_COOKIE as u8;
    header[8..20].copy_from_slice(&transaction_id);

    (header, transaction_id)
}

fn parse_stun_response(buf: &[u8], len: usize, expected_tid: &[u8; 12]) -> Result<(String, u16), String> {
    if len < 20 {
        return Err("STUN response too short".to_string());
    }

    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    if msg_type != STUN_CLASS_SUCCESS_RESPONSE {
        return Err(format!("Not a STUN success response: 0x{:04x}", msg_type));
    }

    if &buf[8..20] != expected_tid {
        return Err("Transaction ID mismatch".to_string());
    }

    let magic = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if magic != MAGIC_COOKIE {
        return Err("Invalid magic cookie".to_string());
    }

    let msg_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
    if len < 20 + msg_len {
        return Err("Message length exceeds buffer".to_string());
    }

    let attrs = &buf[20..20 + msg_len];
    let mut i = 0;

    while i + 4 <= attrs.len() {
        let attr_type = u16::from_be_bytes([attrs[i], attrs[i + 1]]);
        let attr_len = u16::from_be_bytes([attrs[i + 2], attrs[i + 3]]) as usize;

        if i + 4 + attr_len > attrs.len() {
            break;
        }

        let data = &attrs[i + 4..i + 4 + attr_len];

        // XOR-MAPPED-ADDRESS (0x0020)
        if attr_type == 0x0020 && data.len() >= 8 && data[0] == 0x00 {
            let family = data[1];
            if family == 0x01 {
                let xor_port = u16::from_be_bytes([data[2], data[3]])
                    ^ ((MAGIC_COOKIE >> 16) as u16);
                let ip = [
                    data[4] ^ ((MAGIC_COOKIE >> 24) as u8),
                    data[5] ^ ((MAGIC_COOKIE >> 16) as u8),
                    data[6] ^ ((MAGIC_COOKIE >> 8) as u8),
                    data[7] ^ (MAGIC_COOKIE as u8),
                ];
                return Ok((format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]), xor_port));
            }
        }

        // MAPPED-ADDRESS (0x0001)
        if attr_type == 0x0001 && data.len() >= 8 && data[0] == 0x00 {
            let family = data[1];
            if family == 0x01 {
                let port = u16::from_be_bytes([data[2], data[3]]);
                return Ok((format!("{}.{}.{}.{}", data[4], data[5], data[6], data[7]), port));
            }
        }

        let padded = attr_len + (4 - attr_len % 4) % 4;
        i += 4 + padded;
    }

    Err("No address attribute in STUN response".to_string())
}

async fn stun_request(addr: SocketAddr, timeout: Duration) -> Result<(String, u16), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("UDP bind failed: {}", e))?;

    let (request, tid) = build_stun_request();

    socket
        .send_to(&request, addr)
        .await
        .map_err(|e| format!("STUN send failed: {}", e))?;

    let mut buf = vec![0u8; 1024];

    // Retransmit up to 3 times with exponential backoff
    let mut current_timeout = timeout;
    for attempt in 0..3 {
        match tokio::time::timeout(current_timeout, socket.recv_from(&mut buf)).await {
            Ok(Ok((len, _))) => {
                return parse_stun_response(&buf, len, &tid);
            }
            Ok(Err(e)) => return Err(format!("STUN recv failed: {}", e)),
            Err(_) => {
                if attempt < 2 {
                    current_timeout = current_timeout * 2;
                    let _ = socket.send_to(&request, addr).await;
                }
            }
        }
    }

    Err("STUN request timed out after retries".to_string())
}

fn is_private_ip(ip: &str) -> bool {
    if let Ok(addr) = ip.parse::<std::net::Ipv4Addr>() {
        let o = addr.octets();
        o[0] == 0
            || o[0] == 127
            || o[0] == 10
            || (o[0] == 172 && (16..=31).contains(&o[1]))
            || (o[0] == 192 && o[1] == 168)
    } else {
        true
    }
}

/// Cached NAT info to avoid re-probing on every call
static mut CACHED_NAT: Option<NatInfo> = None;

/// Resolve a STUN server string ("host:port" or "ip:port") into a SocketAddr,
/// resolving hostnames via DNS (SocketAddr::from_str does not accept hostnames).
fn resolve_stun(server: &str) -> Result<SocketAddr, String> {
    if let Ok(addr) = server.parse::<SocketAddr>() {
        return Ok(addr);
    }
    server
        .to_socket_addrs()
        .map_err(|e| format!("Invalid STUN server: {}", e))?
        .next()
        .ok_or_else(|| format!("Invalid STUN server: no address for {}", server))
}

pub async fn detect_nat(stun_servers: &[&str]) -> Result<NatInfo, String> {
    // Return cached result if available
    unsafe {
        if let Some(ref cached) = CACHED_NAT {
            return Ok(cached.clone());
        }
    }
    let result = detect_nat_uncached(stun_servers).await?;
    unsafe { CACHED_NAT = Some(result.clone()); }
    Ok(result)
}

async fn detect_nat_uncached(stun_servers: &[&str]) -> Result<NatInfo, String> {

    if stun_servers.is_empty() {
        return Err("No STUN servers provided".to_string());
    }

    let timeout = Duration::from_secs(5);

    // Get local address
    let local_socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Local socket bind failed: {}", e))?;
    let local_addr = local_socket.local_addr().map_err(|e| e.to_string())?;
    drop(local_socket);

    let local_ip = local_addr.ip().to_string();
    let local_port = local_addr.port();

    // Step 1: Get external address from first server (with retry)
    let addr1: SocketAddr = resolve_stun(stun_servers[0])?;
    let (ext_ip, ext_port) = stun_request(addr1, timeout).await?;

    if is_private_ip(&ext_ip) {
        return Ok(NatInfo {
            nat_type: NatType::PublicInternet,
            public_ip: ext_ip,
            public_port: ext_port,
            local_ip,
            local_port,
        });
    }

    if stun_servers.len() < 2 {
        return Ok(NatInfo {
            nat_type: NatType::Unknown,
            public_ip: ext_ip,
            public_port: ext_port,
            local_ip,
            local_port,
        });
    }

    // Step 2: Get external address from second server (different IP)
    // If second server fails, try third server
    let addr2: SocketAddr = resolve_stun(stun_servers[1])?;
    let (ext_ip2, ext_port2) = match stun_request(addr2, timeout).await {
        Ok(result) => result,
        Err(_) if stun_servers.len() >= 3 => {
            // Fallback to third server
            let addr3: SocketAddr = resolve_stun(stun_servers[2])?;
            stun_request(addr3, timeout).await?
        }
        Err(e) => return Err(e),
    };

    // Same IP, same port → Full Cone (or no NAT)
    if ext_ip == ext_ip2 && ext_port == ext_port2 {
        return Ok(NatInfo {
            nat_type: NatType::FullCone,
            public_ip: ext_ip,
            public_port: ext_port,
            local_ip,
            local_port,
        });
    }

    // Same IP, different port → need more probing
    // Step 3: Try third server or use port comparison heuristic
    if stun_servers.len() >= 3 {
        let addr3: SocketAddr = resolve_stun(stun_servers[2])?;
        let (_ext_ip3, ext_port3) = stun_request(addr3, timeout).await?;

        // All different ports → Symmetric
        if ext_port != ext_port2 && ext_port != ext_port3 && ext_port2 != ext_port3 {
            return Ok(NatInfo {
                nat_type: NatType::Symmetric,
                public_ip: ext_ip,
                public_port: ext_port,
                local_ip,
                local_port,
            });
        }

        // Same port on at least 2 servers → Port Restricted Cone
        return Ok(NatInfo {
            nat_type: NatType::PortRestricted,
            public_ip: ext_ip,
            public_port: ext_port,
            local_ip,
            local_port,
        });
    }

    // Fallback with 2 servers: different ports → likely Symmetric
    // (This is the RFC 3489 limitation — 2 servers can't distinguish
    // symmetric from port-restricted cone reliably)
    if ext_port != ext_port2 {
        return Ok(NatInfo {
            nat_type: NatType::Symmetric,
            public_ip: ext_ip,
            public_port: ext_port,
            local_ip,
            local_port,
        });
    }

    let result = NatInfo {
        nat_type: NatType::PortRestricted,
        public_ip: ext_ip,
        public_port: ext_port,
        local_ip,
        local_port,
    };

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nat_type_display() {
        assert_eq!(NatType::PublicInternet.to_string(), "public");
        assert_eq!(NatType::FullCone.to_string(), "full_cone");
        assert_eq!(NatType::RestrictedCone.to_string(), "restricted_cone");
        assert_eq!(NatType::PortRestricted.to_string(), "port_restricted");
        assert_eq!(NatType::Symmetric.to_string(), "symmetric");
        assert_eq!(NatType::Unknown.to_string(), "unknown");
    }

    #[test]
    fn test_is_private_ip() {
        assert!(!is_private_ip("8.8.8.8"));
        assert!(!is_private_ip("1.1.1.1"));
        assert!(is_private_ip("192.168.1.1"));
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("172.16.0.1"));
        assert!(is_private_ip("172.31.255.255"));
        assert!(!is_private_ip("172.32.0.1"));
        assert!(is_private_ip("127.0.0.1"));
        assert!(is_private_ip("0.0.0.0"));
    }

    #[test]
    fn test_build_stun_request() {
        let (header, _tid) = build_stun_request();
        let msg_type = u16::from_be_bytes([header[0], header[1]]);
        assert_eq!(msg_type, STUN_METHOD_BINDING);
        let magic = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);
        assert_eq!(magic, MAGIC_COOKIE);
    }

    #[test]
    fn test_parse_stun_response_xor_mapped() {
        let mut buf = [0u8; 32];
        // Success response header
        buf[0] = 0x01;
        buf[1] = 0x01;
        buf[2] = 0;
        buf[3] = 12; // attribute length
        buf[4] = 0x21;
        buf[5] = 0x12;
        buf[6] = 0xa4;
        buf[7] = 0x42;
        let tid = [1u8; 12];
        buf[8..20].copy_from_slice(&tid);

        // XOR-MAPPED-ADDRESS attribute (0x0020)
        buf[20] = 0x00;
        buf[21] = 0x20; // type
        buf[22] = 0;
        buf[23] = 8; // length
        buf[24] = 0x00; // reserved
        buf[25] = 0x01; // IPv4
        // XOR port: real_port ^ 0x2112 → let's set real port = 0x1234
        // 0x1234 ^ 0x2112 = 0x3326
        buf[26] = 0x33;
        buf[27] = 0x26;
        // XOR IP: real_ip = 1.2.3.4 → XOR with magic cookie bytes
        // 1 ^ 0x21 = 0x20, 2 ^ 0x12 = 0x10, 3 ^ 0xa4 = 0xa7, 4 ^ 0x42 = 0x46
        buf[28] = 0x20;
        buf[29] = 0x10;
        buf[30] = 0xa7;
        buf[31] = 0x46;

        let result = parse_stun_response(&buf, 32, &tid).unwrap();
        assert_eq!(result.0, "1.2.3.4");
        assert_eq!(result.1, 0x1234);
    }
}
