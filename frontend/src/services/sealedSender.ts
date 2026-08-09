/**
 * Sealed Sender for NurChat — Phase 2: Metadata Protection
 *
 * Relay cannot see WHO is sending messages to WHOM.
 * Only the recipient can identify the sender.
 *
 * Protocol:
 * 1. Sender generates ephemeral keypair
 * 2. Sender encrypts {sender_id, timestamp, nonce} with recipient's public key
 * 3. Sender sends: {ephemeral_pub, encrypted_metadata, message_ciphertext}
 * 4. Relay delivers blindly (cannot decrypt metadata)
 * 5. Recipient decrypts metadata, then message
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import {
  boxKeyPair,
  boxBefore,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  bytesToHex,
  hexToBytes,
  type BoxKeyPair,
} from "./cryptoAdapter"

// ─── Types ───

export interface SealedSenderEnvelope {
  /** Ephemeral public key (hex) used for sealed box */
  ephemeralPubHex: string
  /** Encrypted metadata: {sender_id, timestamp} */
  encryptedMetadata: string
  /** The actual message ciphertext (from Double Ratchet or other) */
  messageCiphertext: string
  /** Nonce for sealed box (hex) */
  nonceHex: string
}

export interface SealedMetadata {
  senderId: string
  timestamp: number
  nonce: string
}

// ─── Constants ───

const MAX_METADATA_SIZE = 256 // Max size of metadata JSON

// ─── Core Functions ───

/**
 * Create a sealed sender envelope.
 * Encrypts sender metadata so relay cannot see who is sending.
 *
 * @param recipientPublicKey - Recipient's X25519 public key (hex)
 * @param senderId - Sender's user ID
 * @param messageCiphertext - The encrypted message (from Double Ratchet)
 * @returns SealedSenderEnvelope ready to send to relay
 */
export function createSealedSenderEnvelope(
  recipientPublicKeyHex: string,
  senderId: string,
  messageCiphertext: string,
): SealedSenderEnvelope {
  // 1. Generate ephemeral keypair
  const ephemeralKp = boxKeyPair()

  // 2. Prepare metadata
  const metadata: SealedMetadata = {
    senderId,
    timestamp: Date.now(),
    nonce: bytesToHex(randomBytes(16)),
  }

  // 3. Serialize metadata
  const metadataJson = JSON.stringify(metadata)
  if (metadataJson.length > MAX_METADATA_SIZE) {
    throw new Error(`Metadata too large: ${metadataJson.length} > ${MAX_METADATA_SIZE}`)
  }

  // 4. Encrypt metadata with recipient's public key
  const recipientPub = hexToBytes(recipientPublicKeyHex)
  const sharedSecret = boxBefore(recipientPub, ephemeralKp.secretKey)

  const nonce = randomBytes(secretboxNonceLength)
  const metadataBytes = new TextEncoder().encode(metadataJson)
  const encryptedMetadata = secretboxEncrypt(metadataBytes, nonce, sharedSecret)

  // 5. Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + encryptedMetadata.length)
  combined.set(nonce)
  combined.set(encryptedMetadata, nonce.length)

  // 6. Extract public key BEFORE zeroizing (public key is not secret, but we need it)
  const ephemeralPubHex = bytesToHex(ephemeralKp.publicKey)

  // 7. Cleanup ephemeral secret key (zeroize secret, keep public for envelope)
  zeroizeBytes(ephemeralKp.secretKey)

  // 8. Cleanup shared secret
  zeroizeBytes(sharedSecret)

  return {
    ephemeralPubHex,
    encryptedMetadata: btoa(String.fromCharCode(...combined)),
    messageCiphertext,
    nonceHex: bytesToHex(nonce),
  }
}

/**
 * Decrypt sealed sender envelope.
 * Recipient identifies the sender and decrypts the message.
 *
 * @param envelope - SealedSenderEnvelope from relay
 * @param myPrivateKey - Recipient's X25519 private key (hex)
 * @returns Sender ID and decrypted message ciphertext
 */
export function openSealedSenderEnvelope(
  envelope: SealedSenderEnvelope,
  myPrivateKeyHex: string,
): { senderId: string; messageCiphertext: string } | null {
  try {
    // 1. Reconstruct shared secret from ephemeral public + our private
    const ephemeralPub = hexToBytes(envelope.ephemeralPubHex)
    const myPrivateKey = hexToBytes(myPrivateKeyHex)
    const sharedSecret = boxBefore(ephemeralPub, myPrivateKey)

    // 2. Decrypt metadata
    const combined = new Uint8Array(
      atob(envelope.encryptedMetadata).split("").map((c) => c.charCodeAt(0))
    )
    const nonce = combined.subarray(0, secretboxNonceLength)
    const ciphertext = combined.subarray(secretboxNonceLength)

    const metadataBytes = secretboxDecrypt(ciphertext, nonce, sharedSecret)
    if (!metadataBytes) {
      console.warn("[SealedSender] Failed to decrypt metadata — wrong key or tampered data")
      return null
    }

    // 3. Parse metadata
    const metadataJson = new TextDecoder().decode(metadataBytes)
    const metadata: SealedMetadata = JSON.parse(metadataJson)

    // 4. Validate timestamp (5 minute window)
    const now = Date.now()
    const age = now - metadata.timestamp
    if (age < 0 || age > 5 * 60 * 1000) {
      console.warn(`[SealedSender] Metadata timestamp out of range: ${age}ms`)
      return null
    }

    // 5. Cleanup sensitive data
    zeroizeBytes(myPrivateKey)
    zeroizeBytes(ephemeralPub)
    zeroizeBytes(sharedSecret)

    return {
      senderId: metadata.senderId,
      messageCiphertext: envelope.messageCiphertext,
    }
  } catch (err) {
    console.warn("[SealedSender] Failed to open envelope:", err)
    return null
  }
}

/**
 * Create a sealed sender envelope for broadcast (group chat).
 * Each participant gets their own sealed box.
 *
 * @param recipientPublicKeys - Array of recipient public keys (hex)
 * @param senderId - Sender's user ID
 * @param messageCiphertext - The encrypted message
 * @returns Array of sealed envelopes, one per recipient
 */
export function createSealedSenderBroadcast(
  recipientPublicKeysHex: string[],
  senderId: string,
  messageCiphertext: string,
): SealedSenderEnvelope[] {
  return recipientPublicKeysHex.map((recipientPubHex) =>
    createSealedSenderEnvelope(recipientPubHex, senderId, messageCiphertext)
  )
}

/**
 * Verify that a sealed sender envelope is well-formed.
 * Does NOT decrypt (useful for relay-side validation).
 *
 * @param envelope - SealedSenderEnvelope to validate
 * @returns true if envelope structure is valid
 */
export function validateSealedSenderEnvelope(envelope: SealedSenderEnvelope): boolean {
  // Check required fields
  if (!envelope.ephemeralPubHex || !envelope.encryptedMetadata || !envelope.messageCiphertext) {
    return false
  }

  // Validate ephemeral public key (32 bytes = 64 hex chars)
  if (envelope.ephemeralPubHex.length !== 64) {
    return false
  }

  // Validate nonce hex
  if (envelope.nonceHex && envelope.nonceHex.length !== 32) {
    return false
  }

  return true
}

// ─── Helpers ───

function zeroizeKeypair(kp: BoxKeyPair): void {
  zeroizeBytes(kp.secretKey)
}

function zeroizeBytes(buffer: Uint8Array | null): void {
  if (!buffer) return
  buffer.fill(0)
  try {
    if (buffer.buffer instanceof ArrayBuffer && typeof buffer.buffer.transfer === "function") {
      buffer.buffer.transfer(0)
    }
  } catch {
    // ignore transfer errors
  }
}

// ─── Message Padding (Phase 2.2) ───

/**
 * Padding block sizes for message obfuscation.
 * Messages are padded to the next power of 2.
 */
const PADDING_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384]

/**
 * Pad a message to hide its actual size from the relay.
 * Uses PKCS7-style padding.
 *
 * @param data - Original message bytes
 * @returns Padded message bytes
 */
export function padMessage(data: Uint8Array): Uint8Array {
  // Find the next power of 2 that fits the data
  let targetSize = PADDING_SIZES[0]
  for (const size of PADDING_SIZES) {
    if (data.length <= size) {
      targetSize = size
      break
    }
    targetSize = size
  }
  // If data is larger than max padding, return as-is
  if (data.length > targetSize) {
    return data
  }

  const paddingNeeded = targetSize - data.length
  const padded = new Uint8Array(targetSize)
  padded.set(data)
  // PKCS7 padding: fill remaining bytes with padding size
  padded.fill(paddingNeeded, data.length)
  return padded
}

/**
 * Remove padding from a message.
 *
 * @param data - Padded message bytes
 * @returns Original message bytes
 */
export function unpadMessage(data: Uint8Array): Uint8Array {
  if (!data || data.length === 0) return data

  const paddingSize = data[data.length - 1]
  if (paddingSize === 0 || paddingSize > data.length) {
    return data
  }

  // Verify PKCS7 padding is consistent
  for (let i = data.length - paddingSize; i < data.length; i++) {
    if (data[i] !== paddingSize) {
      return data // Invalid padding, return as-is
    }
  }

  return data.slice(0, data.length - paddingSize)
}

/**
 * Get the padded size for a given data length.
 *
 * @param dataLength - Original data length
 * @returns Padded size
 */
export function getPaddedSize(dataLength: number): number {
  for (const size of PADDING_SIZES) {
    if (dataLength <= size) return size
  }
  return dataLength
}
