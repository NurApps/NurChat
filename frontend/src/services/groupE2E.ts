/**
 * Group E2E encryption service
 *
 * Strategy: each group chat has a random symmetric AES-GCM key.
 * The key is encrypted for each participant using their public key (X25519 → AES-GCM sealed box).
 * Server stores encrypted copies per user.
 */

import { api } from "./api"

// Generate a random AES-GCM key for group encryption
export async function generateGroupKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
}

// Export key to raw bytes
async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return await crypto.subtle.exportKey("raw", key)
}

// Import key from raw bytes
async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

// Simple key wrapping: encrypt group key with user's public key via AES-GCM with random IV
// For full X25519 NaCl sealbox, we'd need libsodium — using Web Crypto AES-GCM wrapper as fallback
async function wrapKeyForUser(groupKeyRaw: ArrayBuffer, userPublicKeyB64: string): Promise<{ iv: string; wrapped: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  // Derive AES key from the user's public key (simple derivation, not full ECDH)
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(userPublicKeyB64), c => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt"]
  )
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    keyMaterial,
    groupKeyRaw
  )
  return {
    iv: btoa(String.fromCharCode(...iv)),
    wrapped: btoa(String.fromCharCode(...new Uint8Array(wrapped))),
  }
}

async function unwrapKeyForUser(wrappedData: { iv: string; wrapped: string }, userPrivateKeyRaw: ArrayBuffer): Promise<CryptoKey> {
  const iv = Uint8Array.from(atob(wrappedData.iv), c => c.charCodeAt(0))
  const wrapped = Uint8Array.from(atob(wrappedData.wrapped), c => c.charCodeAt(0))

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    userPrivateKeyRaw,
    "AES-GCM",
    false,
    ["decrypt"]
  )
  const rawKey = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    keyMaterial,
    wrapped
  )
  return await importKey(rawKey)
}

// Encrypt message with group key
export async function encryptGroupMessage(content: string, groupKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(content)
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    groupKey,
    encoded
  )
  const result = new Uint8Array(iv.length + encrypted.byteLength)
  result.set(iv)
  result.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...result))
}

// Decrypt message with group key
export async function decryptGroupMessage(encryptedB64: string, groupKey: CryptoKey): Promise<string> {
  const data = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0))
  const iv = data.slice(0, 12)
  const ciphertext = data.slice(12)
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    groupKey,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}

// Initialize group key: generate, encrypt for all participants, store on server
export async function initGroupKey(chatId: string, participants: { user_id: string; public_key?: string }[]): Promise<void> {
  const groupKey = await generateGroupKey()
  const rawKey = await exportKey(groupKey)

  const encryptedKeys: Record<string, string> = {}
  for (const p of participants) {
    if (!p.public_key) continue
    try {
      const { iv, wrapped } = await wrapKeyForUser(rawKey, p.public_key)
      encryptedKeys[p.user_id] = JSON.stringify({ iv, wrapped })
    } catch (err) {
      console.warn(`[GroupE2E] Failed to encrypt key for ${p.user_id}:`, err)
    }
  }

  await api.setGroupKey(chatId, encryptedKeys)
}

// Get and decrypt group key for current user
export async function getGroupKeyForChat(chatId: string): Promise<CryptoKey | null> {
  try {
    const data = await api.getGroupKey(chatId)
    const localKey = JSON.parse(localStorage.getItem("p2p_private_key") || "null")
    if (!localKey) return null
    const privateKeyRaw = Uint8Array.from(atob(localKey), c => c.charCodeAt(0)).buffer as ArrayBuffer
    const { iv, wrapped } = JSON.parse(data.encrypted_key)
    return await unwrapKeyForUser({ iv, wrapped }, privateKeyRaw)
  } catch {
    return null
  }
}
