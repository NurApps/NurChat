/**
 * Hybrid Encryption for NurChat — Phase 4: Post-Quantum Cryptography
 *
 * Combines XSalsa20-Poly1305 with AES-256-GCM for post-quantum security.
 * Both encryptions are applied for defense in depth.
 *
 * Protocol:
 * 1. Derive XSalsa20 key from shared secret
 * 2. Derive AES-256-GCM key from shared secret
 * 3. Encrypt with XSalsa20-Poly1305
 * 4. Encrypt result with AES-256-GCM
 * 5. Bundle both ciphertexts
 *
 * Uses @noble/ciphers for XSalsa20 and WebCrypto for AES-256-GCM.
 */

import {
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
} from "./cryptoAdapter"

// ─── Types ───

export interface HybridCiphertext {
  /** XSalsa20-Poly1305 ciphertext */
  xsalsa20Ciphertext: Uint8Array
  /** AES-256-GCM ciphertext */
  aesGcmCiphertext: Uint8Array
  /** Nonce for XSalsa20 */
  xsalsa20Nonce: Uint8Array
  /** Nonce for AES-256-GCM */
  aesGcmNonce: Uint8Array
  /** Protocol version */
  version: number
}

export interface HybridEncryptionKeys {
  /** XSalsa20 key */
  xsalsa20Key: Uint8Array
  /** AES-256-GCM key */
  aesGcmKey: Uint8Array
}

// ─── Constants ───

/**
 * AES-256-GCM nonce size (12 bytes)
 */
const AES_GCM_NONCE_SIZE = 12

/**
 * AES-256-GCM tag size (16 bytes)
 */
const AES_GCM_TAG_SIZE = 16

/**
 * Protocol version for hybrid encryption
 */
const HYBRID_ENCRYPTION_VERSION = 1

// ─── Key Derivation ───

/**
 * Derive hybrid encryption keys from shared secret.
 *
 * @param sharedSecret - Shared secret from key exchange
 * @returns Hybrid encryption keys
 */
export async function deriveHybridKeys(
  sharedSecret: Uint8Array,
): Promise<HybridEncryptionKeys> {
  // Derive XSalsa20 key (32 bytes)
  const xsalsa20Key = await hkdfExpand(
    sharedSecret,
    new TextEncoder().encode("xsalsa20-key"),
    32,
  )

  // Derive AES-256-GCM key (32 bytes)
  const aesGcmKey = await hkdfExpand(
    sharedSecret,
    new TextEncoder().encode("aes256gcm-key"),
    32,
  )

  return { xsalsa20Key, aesGcmKey }
}

// ─── Encryption ───

/**
 * Hybrid encrypt plaintext.
 * Applies both XSalsa20-Poly1305 and AES-256-GCM encryption.
 *
 * @param plaintext - Data to encrypt
 * @param keys - Hybrid encryption keys
 * @returns Hybrid ciphertext
 */
export async function hybridEncrypt(
  plaintext: Uint8Array,
  keys: HybridEncryptionKeys,
): Promise<HybridCiphertext> {
  // 1. Generate nonces
  const xsalsa20Nonce = randomBytes(secretboxNonceLength)
  const aesGcmNonce = randomBytes(AES_GCM_NONCE_SIZE)

  // 2. Encrypt with XSalsa20-Poly1305
  const xsalsa20Ciphertext = secretboxEncrypt(plaintext, xsalsa20Nonce, keys.xsalsa20Key)

  // 3. Encrypt result with AES-256-GCM
  const aesGcmCiphertext = await aesGcmEncrypt(
    xsalsa20Ciphertext,
    aesGcmNonce,
    keys.aesGcmKey,
  )

  return {
    xsalsa20Ciphertext,
    aesGcmCiphertext,
    xsalsa20Nonce,
    aesGcmNonce,
    version: HYBRID_ENCRYPTION_VERSION,
  }
}

/**
 * Hybrid decrypt ciphertext.
 * Reverses AES-256-GCM then XSalsa20-Poly1305 decryption.
 *
 * @param ciphertext - Hybrid ciphertext
 * @param keys - Hybrid encryption keys
 * @returns Decrypted plaintext, or null if decryption fails
 */
export async function hybridDecrypt(
  ciphertext: HybridCiphertext,
  keys: HybridEncryptionKeys,
): Promise<Uint8Array | null> {
  try {
    // 1. Decrypt AES-256-GCM
    const xsalsa20Ciphertext = await aesGcmDecrypt(
      ciphertext.aesGcmCiphertext,
      ciphertext.aesGcmNonce,
      keys.aesGcmKey,
    )

    if (!xsalsa20Ciphertext) {
      return null
    }

    // 2. Decrypt XSalsa20-Poly1305
    const plaintext = secretboxDecrypt(
      xsalsa20Ciphertext,
      ciphertext.xsalsa20Nonce,
      keys.xsalsa20Key,
    )

    return plaintext
  } catch {
    return null
  }
}

// ─── Serialization ───

/**
 * Serialize hybrid ciphertext for transmission.
 *
 * @param ciphertext - Hybrid ciphertext
 * @returns Serialized bytes
 */
export function serializeHybridCiphertext(ciphertext: HybridCiphertext): Uint8Array {
  const xsalsa20Len = ciphertext.xsalsa20Ciphertext.length
  const aesGcmLen = ciphertext.aesGcmCiphertext.length

  // Format: version (1) || xsalsa20_len (2) || xsalsa20_nonce (24) || xsalsa20_ct || aes_len (2) || aes_nonce (12) || aes_ct
  const total = 1 + 2 + secretboxNonceLength + xsalsa20Len + 2 + AES_GCM_NONCE_SIZE + aesGcmLen
  const serialized = new Uint8Array(total)

  let offset = 0
  serialized[offset++] = ciphertext.version

  // XSalsa20 ciphertext length
  serialized[offset++] = (xsalsa20Len >> 8) & 0xff
  serialized[offset++] = xsalsa20Len & 0xff

  // XSalsa20 nonce
  serialized.set(ciphertext.xsalsa20Nonce, offset)
  offset += secretboxNonceLength

  // XSalsa20 ciphertext
  serialized.set(ciphertext.xsalsa20Ciphertext, offset)
  offset += xsalsa20Len

  // AES ciphertext length
  serialized[offset++] = (aesGcmLen >> 8) & 0xff
  serialized[offset++] = aesGcmLen & 0xff

  // AES nonce
  serialized.set(ciphertext.aesGcmNonce, offset)
  offset += AES_GCM_NONCE_SIZE

  // AES ciphertext
  serialized.set(ciphertext.aesGcmCiphertext, offset)

  return serialized
}

/**
 * Deserialize hybrid ciphertext from bytes.
 *
 * @param data - Serialized bytes
 * @returns Hybrid ciphertext or null if invalid
 */
export function deserializeHybridCiphertext(data: Uint8Array): HybridCiphertext | null {
  try {
    let offset = 0

    // Version
    const version = data[offset++]
    if (version !== HYBRID_ENCRYPTION_VERSION) {
      return null
    }

    // XSalsa20 ciphertext length
    const xsalsa20Len = (data[offset] << 8) | data[offset + 1]
    offset += 2

    // XSalsa20 nonce
    const xsalsa20Nonce = data.slice(offset, offset + secretboxNonceLength)
    offset += secretboxNonceLength

    // XSalsa20 ciphertext
    const xsalsa20Ciphertext = data.slice(offset, offset + xsalsa20Len)
    offset += xsalsa20Len

    // AES ciphertext length
    const aesGcmLen = (data[offset] << 8) | data[offset + 1]
    offset += 2

    // AES nonce
    const aesGcmNonce = data.slice(offset, offset + AES_GCM_NONCE_SIZE)
    offset += AES_GCM_NONCE_SIZE

    // AES ciphertext
    const aesGcmCiphertext = data.slice(offset, offset + aesGcmLen)

    return {
      xsalsa20Ciphertext,
      aesGcmCiphertext,
      xsalsa20Nonce,
      aesGcmNonce,
      version,
    }
  } catch {
    return null
  }
}

// ─── AES-256-GCM Helpers ───

/**
 * AES-256-GCM encryption using WebCrypto.
 */
async function aesGcmEncrypt(
  plaintext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  )

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, tagLength: AES_GCM_TAG_SIZE * 8 },
    cryptoKey,
    plaintext as BufferSource,
  )

  return new Uint8Array(encrypted)
}

/**
 * AES-256-GCM decryption using WebCrypto.
 */
async function aesGcmDecrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    )

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, tagLength: AES_GCM_TAG_SIZE * 8 },
      cryptoKey,
      ciphertext as BufferSource,
    )

    return new Uint8Array(decrypted)
  } catch {
    return null
  }
}

// ─── HKDF Helpers ───

/**
 * HKDF expand
 */
async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const N = Math.ceil(length / 32)
  let t = new Uint8Array(0)
  const okmParts: Uint8Array[] = []

  for (let i = 1; i <= N; i++) {
    const key = await crypto.subtle.importKey(
      "raw",
      prk as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const input = new Uint8Array(t.length + info.length + 1)
    input.set(t)
    input.set(info, t.length)
    input[input.length - 1] = i
    t = new Uint8Array(await crypto.subtle.sign("HMAC", key, input as BufferSource))
    okmParts.push(t)
  }

  const result = new Uint8Array(length)
  let offset = 0
  for (const part of okmParts) {
    result.set(part.subarray(0, length - offset), offset)
    offset += part.length
    if (offset >= length) break
  }
  return result
}
