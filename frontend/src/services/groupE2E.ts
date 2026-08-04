/**
 * Group E2E encryption service
 *
 * Strategy: each group chat has a random symmetric key (32 bytes).
 * The key is wrapped for each participant using X25519 ECDH + XSalsa20-Poly1305.
 * Server stores encrypted copies per user.
 *
 * Group ratchet: each message derives a unique message key via HKDF chain.
 * Forward secrecy: compromising the current chain key only exposes future messages.
 */

import nacl from "tweetnacl"
import { encode as base64Encode, decode as base64Decode } from "base64-arraybuffer"
import { api } from "./api"

const GROUP_RATCHET_KEY = "group_ratchet_states"
const GROUP_KEY_ROTATION_INTERVAL = 50
const MAX_GROUP_SKIP = 500

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
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

// ─── Group Ratchet ───
// Symmetric KDF chain: each message derives a unique key from the chain.
// Provides forward secrecy without needing to re-distribute keys.

interface GroupRatchetState {
  chainKey: string   // base64
  step: number
  skippedKeys: Record<string, string>  // "step" -> base64 msgKey
}

function _loadRatchetStates(): Record<string, GroupRatchetState> {
  try {
    const raw = localStorage.getItem(GROUP_RATCHET_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function _saveRatchetStates(states: Record<string, GroupRatchetState>): void {
  localStorage.setItem(GROUP_RATCHET_KEY, JSON.stringify(states))
}

async function _groupChainNext(chainKey: Uint8Array, step: number): Promise<{ msgKey: Uint8Array; nextChain: Uint8Array }> {
  const infoMsg = new TextEncoder().encode(`group_msg_${step}`)
  const infoChain = new TextEncoder().encode(`group_chain_${step}`)
  // Use HKDF-like derivation: HMAC-based
  const msgKey = await _hmacDerive(chainKey, infoMsg)
  const nextChain = await _hmacDerive(chainKey, infoChain)
  return { msgKey, nextChain }
}

async function _hmacDerive(key: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  // Simple HKDF-like: extract-and-expand using NaCl
  const combined = new Uint8Array(key.length + info.length)
  combined.set(key)
  combined.set(info, key.length)
  // Hash with SHA-512 then take first 32 bytes
  const hash = nacl.hash(combined)
  return hash.slice(0, 32)
}

// Encrypt with group ratchet: derives per-message key from chain
export async function encryptGroupMessageRatcheted(
  content: string,
  groupKey: Uint8Array,
  chatId: string,
): Promise<string> {
  const states = _loadRatchetStates()
  let state = states[chatId]

  if (!state) {
    // Initialize ratchet from group key
    state = { chainKey: base64Encode(groupKey.buffer as ArrayBuffer), step: 0, skippedKeys: {} }
  }

  const chainKeyBytes = base64Decode(state.chainKey)
  const { msgKey, nextChain } = await _groupChainNext(chainKeyBytes, state.step)

  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const msgBytes = new TextEncoder().encode(content)
  const ciphertext = nacl.secretbox(msgBytes, nonce, msgKey)

  // Envelope: step (4 bytes big-endian) || nonce || ciphertext
  const stepBytes = new Uint8Array(4)
  new DataView(stepBytes.buffer).setUint32(0, state.step, false)
  const result = new Uint8Array(4 + nonce.length + ciphertext.length)
  result.set(stepBytes)
  result.set(nonce, 4)
  result.set(ciphertext, 4 + nonce.length)

  // Advance chain
  state.chainKey = base64Encode(nextChain.buffer as ArrayBuffer)
  state.step += 1

  // Periodically re-derive chain key from root key to prevent infinite growth
  if (state.step % GROUP_KEY_ROTATION_INTERVAL === 0) {
    const reDerived = await _hmacDerive(groupKey, new TextEncoder().encode(`group_ratchet_${state.step}`))
    state.chainKey = base64Encode(reDerived.buffer as ArrayBuffer)
  }

  states[chatId] = state
  _saveRatchetStates(states)

  return base64Encode(result.buffer as ArrayBuffer)
}

// Decrypt with group ratchet: derives message key from step
export async function decryptGroupMessageRatcheted(
  encryptedB64: string,
  groupKey: Uint8Array,
  chatId: string,
): Promise<string | null> {
  try {
    const data = new Uint8Array(base64Decode(encryptedB64))

    // Parse envelope: step (4 bytes) || nonce || ciphertext
    if (data.length < 4 + nacl.secretbox.nonceLength) return null
    const step = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false)
    const nonce = data.subarray(4, 4 + nacl.secretbox.nonceLength)
    const ciphertext = data.subarray(4 + nacl.secretbox.nonceLength)

    const states = _loadRatchetStates()
    let state = states[chatId]

    if (!state) {
      state = { chainKey: base64Encode(groupKey.buffer as ArrayBuffer), step: 0, skippedKeys: {} }
    }

    // Check skipped keys cache
    const skipId = `${step}`
    if (state.skippedKeys[skipId]) {
      const msgKey = base64Decode(state.skippedKeys[skipId])
      const plaintext = nacl.secretbox.open(ciphertext, nonce, msgKey)
      if (plaintext) {
        delete state.skippedKeys[skipId]
        states[chatId] = state
        _saveRatchetStates(states)
        return new TextDecoder().decode(plaintext)
      }
      return null
    }

    // If step is ahead, derive intermediate keys and cache them
    if (step > state.step) {
      if (step - state.step > MAX_GROUP_SKIP) return null

      let chainKeyBytes = base64Decode(state.chainKey)
      for (let s = state.step; s < step; s++) {
        const { msgKey, nextChain } = await _groupChainNext(chainKeyBytes, s)
        state.skippedKeys[`${s}`] = base64Encode(msgKey.buffer as ArrayBuffer)
        chainKeyBytes = nextChain
      }

      // Derive the actual message key
      const { msgKey, nextChain } = await _groupChainNext(chainKeyBytes, step)
      const plaintext = nacl.secretbox.open(ciphertext, nonce, msgKey)

      // Advance state
      state.chainKey = base64Encode(nextChain.buffer as ArrayBuffer)
      state.step = step + 1

      // Cleanup old skipped keys
      const skipKeys = Object.keys(state.skippedKeys).map(Number).sort((a, b) => a - b)
      for (const k of skipKeys) {
        if (k < state.step - MAX_GROUP_SKIP) delete state.skippedKeys[`${k}`]
      }

      states[chatId] = state
      _saveRatchetStates(states)

      return plaintext ? new TextDecoder().decode(plaintext) : null
    }

    // Step is in the past — can't decrypt (key already ratcheted past)
    return null
  } catch {
    return null
  }
}
