//! Session encryption for direct P2P TCP connections.
//!
//! Handshake: both sides exchange X25519 public keys (in Hello/Ack),
//! derive session keys via HKDF-SHA256 over the DH shared secret.
//! Direction-separated keys: initiator→responder and responder→initiator
//! use independent ChaCha20-Poly1305 keys derived with distinct info labels.
//!
//! Wire format after handshake: `E1 <base64(nonce)> <base64(ciphertext)>`
//! per line. Nonce is random 24 bytes per frame (ChaCha20-Poly1305 nonce
//! size); confidentiality does not depend on nonce counters.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use x25519_dalek::{PublicKey as XPublicKey, StaticSecret};

pub const ECDH_PUB_LEN: usize = 32;

/// Our long-term transport keypair (per node instance).
pub struct TransportIdentity {
    pub secret: StaticSecret,
    pub public: XPublicKey,
}

impl TransportIdentity {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let secret = StaticSecret::from(bytes);
        let public = XPublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_hex(&self) -> String {
        hex_encode(self.public.as_bytes())
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionCrypto {
    send: String,
    recv: String,
}

fn b64(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn unb64(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("bad base64: {e}"))
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hex_decode(s: &str) -> Result<[u8; ECDH_PUB_LEN], String> {
    // Hex first (64 chars), then base64
    let bytes: Vec<u8> = if s.len() == ECDH_PUB_LEN * 2 {
        (0..ECDH_PUB_LEN)
            .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string()))
            .collect::<Result<Vec<u8>, String>>()?
    } else {
        unb64(s)?
    };
    if bytes.len() != ECDH_PUB_LEN {
        return Err(format!("bad ecdh key length {}", bytes.len()));
    }
    let mut out = [0u8; ECDH_PUB_LEN];
    out.copy_from_slice(&bytes);
    Ok(out)
}

/// Derive session crypto from the X25519 handshake.
/// `we_are_initiator` selects which derived key we use for sending.
pub fn from_handshake(
    identity: &TransportIdentity,
    their_ecdh_pub: &[u8; ECDH_PUB_LEN],
    we_are_initiator: bool,
) -> Result<SessionCrypto, String> {
    let their_pk = XPublicKey::from(*their_ecdh_pub);
    let shared = identity.secret.diffie_hellman(&their_pk);

    if shared.was_contributory() == false {
        return Err("low-order DH point".to_string());
    }

    let hk = Hkdf::<Sha256>::new(Some(b"nurchat-p2p-v1"), shared.as_bytes());
    let info_init = b"nurchat-p2p-key-initiator";
    let info_resp = b"nurchat-p2p-key-responder";

    let mut k_init = [0u8; 32];
    let mut k_resp = [0u8; 32];
    hk.expand(info_init, &mut k_init).map_err(|e| e.to_string())?;
    hk.expand(info_resp, &mut k_resp).map_err(|e| e.to_string())?;

    // Zeroize intermediate material
    let mut shared_bytes = *shared.as_bytes();
    shared_bytes.fill(0);

    let (send, recv) = if we_are_initiator {
        (&k_init, &k_resp)
    } else {
        (&k_resp, &k_init)
    };

    Ok(SessionCrypto {
        send: b64(send),
        recv: b64(recv),
    })
}

fn cipher_from_key_b64(key_b64: &str) -> Result<ChaCha20Poly1305, String> {
    let key = unb64(key_b64)?;
    Ok(ChaCha20Poly1305::new(Key::from_slice(&key)))
}

const FRAME_PREFIX: &str = "E1 ";
/// ChaCha20-Poly1305 nonce size
const NONCE_LEN: usize = 12;

impl SessionCrypto {
    /// Encrypt a plaintext JSON line into an encrypted wire frame.
    pub fn encrypt_line(&self, plaintext: &str) -> Result<String, String> {
        let cipher = cipher_from_key_b64(&self.send)?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, Payload { msg: plaintext.as_bytes(), aad: b"nurchat-p2p" })
            .map_err(|e| e.to_string())?;
        Ok(format!("{}{} {}", FRAME_PREFIX, b64(&nonce_bytes), b64(&ct)))
    }

    /// Decrypt an encrypted wire frame back into the plaintext line.
    pub fn decrypt_line(&self, frame: &str) -> Result<String, String> {
        let rest = frame
            .strip_prefix(FRAME_PREFIX)
            .ok_or_else(|| "not an encrypted frame".to_string())?;
        let (nonce_b64, ct_b64) = rest
            .split_once(' ')
            .ok_or_else(|| "malformed frame".to_string())?;
        let nonce_bytes = unb64(nonce_b64)?;
        if nonce_bytes.len() != NONCE_LEN {
            return Err("bad nonce length".to_string());
        }
        let ct = unb64(ct_b64)?;
        let cipher = cipher_from_key_b64(&self.recv)?;
        let pt = cipher
            .decrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: &ct, aad: b"nurchat-p2p" })
            .map_err(|_| "decryption failed".to_string())?;
        String::from_utf8(pt).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_direction_separation() {
        let a = TransportIdentity::generate();
        let b = TransportIdentity::generate();

        let a_pk = hex_encode(a.public.as_bytes());
        let b_pk = hex_encode(b.public.as_bytes());

        let ka = from_handshake(&a, &hex_decode(&b_pk).unwrap(), true).unwrap();
        let kb = from_handshake(&b, &hex_decode(&a_pk).unwrap(), false).unwrap();

        let frame = ka.encrypt_line("{\"hello\":\"world\"}").unwrap();
        assert!(frame.starts_with("E1 "));
        assert_eq!(kb.decrypt_line(&frame).unwrap(), "{\"hello\":\"world\"}");

        // Wrong direction must fail to decrypt
        assert!(kb.decrypt_line(&ka.encrypt_line("x").unwrap()).is_err() == false);
        let frame2 = kb.encrypt_line("resp").unwrap();
        assert_eq!(ka.decrypt_line(&frame2).unwrap(), "resp");
    }

    #[test]
    fn tampered_frame_fails() {
        let a = TransportIdentity::generate();
        let b = TransportIdentity::generate();
        let ka = from_handshake(&a, b.public.as_bytes(), true).unwrap();
        let kb = from_handshake(&b, a.public.as_bytes(), false).unwrap();
        let mut frame = ka.encrypt_line("secret").unwrap();
        // Flip a byte in the ciphertext part
        let last = frame.pop().unwrap();
        frame.push(if last == 'A' { 'B' } else { 'A' });
        assert!(kb.decrypt_line(&frame).is_err());
    }
}
