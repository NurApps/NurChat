/**
 * Group E2E encryption service
 *
 * Strategy: each group chat has a random symmetric key (32 bytes).
 * The key is wrapped for each participant using X25519 ECDH + XSalsa20-Poly1305.
 * Server stores encrypted copies per user.
 */

import nacl from "tweetnacl"
import { encode as base64Encode, decode as base64Decode } from "base64-arraybuffer"
import { api } from "./api"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Generate a random group key (32 bytes)
export function generateGroupKey(): Uint8Array {
  return nacl.randomBytes(32)
}

// Wrap group key for a participant using X25519 ECDH + secretbox
// mySecretKey: sender's X25519 secret key (bytes)
// theirPublicKey: recipient's X25519 public key (bytes, 32)
// Returns: base64(nonce || encrypted_key)
function wrapKeyForUser(groupKey: Uint8Array, mySecretKey: Uint8Array, theirPublicKey: Uint8Array): string {
  const sharedSecret = nacl.box.before(theirPublicKey, mySecretKey)
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const encrypted = nacl.secretbox(groupKey, nonce, sharedSecret)
  const combined = new Uint8Array(nonce.length + encrypted.length)
  combined.set(nonce)
  combined.set(encrypted, nonce.length)
  return base64Encode(combined.buffer as ArrayBuffer)
}

// Unwrap group key using X25519 ECDH + secretbox
// mySecretKey: recipient's X25519 secret key (bytes)
// theirPublicKey: sender's X25519 public key (bytes, 32)
// wrappedB64: base64(nonce || encrypted_key)
function unwrapKeyForUser(wrappedB64: string, mySecretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array | null {
  try {
    const sharedSecret = nacl.box.before(theirPublicKey, mySecretKey)
    const combined = new Uint8Array(base64Decode(wrappedB64))
    const nonce = combined.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = combined.subarray(nacl.secretbox.nonceLength)
    return nacl.secretbox.open(ciphertext, nonce, sharedSecret) ?? null
  } catch {
    return null
  }
}

// Encrypt message with group key using nacl.secretbox (XSalsa20-Poly1305)
export function encryptGroupMessage(content: string, groupKey: Uint8Array): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const msgBytes = new TextEncoder().encode(content)
  const ciphertext = nacl.secretbox(msgBytes, nonce, groupKey)
  const result = new Uint8Array(nonce.length + ciphertext.length)
  result.set(nonce)
  result.set(ciphertext, nonce.length)
  return base64Encode(result.buffer as ArrayBuffer)
}

// Decrypt message with group key
export function decryptGroupMessage(encryptedB64: string, groupKey: Uint8Array): string | null {
  try {
    const data = new Uint8Array(base64Decode(encryptedB64))
    const nonce = data.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = data.subarray(nacl.secretbox.nonceLength)
    const plaintext = nacl.secretbox.open(ciphertext, nonce, groupKey)
    return plaintext ? new TextDecoder().decode(plaintext) : null
  } catch {
    return null
  }
}

// Initialize group key: generate, wrap for all participants, store on server
export async function initGroupKey(
  chatId: string,
  mySecretKey: Uint8Array,
  participants: { user_id: string; public_key?: string }[],
): Promise<void> {
  const groupKey = generateGroupKey()

  const encryptedKeys: Record<string, string> = {}
  for (const p of participants) {
    if (!p.public_key) continue
    try {
      const wrapped = wrapKeyForUser(groupKey, mySecretKey, hexToBytes(p.public_key))
      encryptedKeys[p.user_id] = wrapped
    } catch (err) {
      console.warn(`[GroupE2E] Failed to encrypt key for ${p.user_id}:`, err)
    }
  }

  await api.setGroupKey(chatId, encryptedKeys)
}

// Get and decrypt group key for current user
export function unwrapGroupKey(
  encryptedKey: string,
  mySecretKey: Uint8Array,
  senderPublicKey: Uint8Array,
): Uint8Array | null {
  return unwrapKeyForUser(encryptedKey, mySecretKey, senderPublicKey)
}

// Fetch group key from server and decrypt it
export async function fetchGroupKey(
  chatId: string,
  mySecretKey: Uint8Array,
  senderPublicKey: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const data = await api.getGroupKey(chatId)
    return unwrapGroupKey(data.encrypted_key, mySecretKey, senderPublicKey)
  } catch {
    return null
  }
}
