/**
 * E2E Encryption Service for NurChat
 *
 * X25519 DH key agreement → blake2b-derived symmetric key → SecretBox encrypt/decrypt
 * Ed25519 signatures for message authenticity
 */
import nacl from "tweetnacl"
import {
  encode as base64Encode,
  decode as base64Decode,
} from "base64-arraybuffer"

// ─── Types ───

export interface E2EKeys {
  privateKeyHex: string
  publicKeyHex: string
  signingPrivateHex: string
  signingPublicHex: string
}

export interface EncryptedEnvelope {
  ciphertext: string   // base64-encoded SecretBox output
  signature: string    // base64-encoded Ed25519 signature
  timestamp: number
  senderId: string
}

// ─── Key Storage ───

const KEYS_KEY = "e2e_keys"

export function loadKeys(): E2EKeys | null {
  try {
    const raw = localStorage.getItem(KEYS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveKeys(keys: E2EKeys) {
  localStorage.setItem(KEYS_KEY, JSON.stringify(keys))
}

export function clearKeys() {
  localStorage.removeItem(KEYS_KEY)
}

export function hasKeys(): boolean {
  return !!loadKeys()
}

// ─── Helpers ───

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

// ─── DH Key Agreement ───

/**
 * X25519 DH: derive shared_secret = my_private * their_public
 * Returns 32-byte shared secret.
 */
function deriveSharedSecret(
  myPrivateKeyHex: string,
  theirPublicKeyHex: string,
): Uint8Array {
  const myPrivate = nacl.box.keyPair.fromSecretKey(hexToBytes(myPrivateKeyHex))
  const theirPublic = hexToBytes(theirPublicKeyHex)
  // X25519 scalar multiplication
  return nacl.box.before(theirPublic, myPrivate.secretKey)
}

/**
 * Derive a 32-byte symmetric key from DH shared secret + chat_id context.
 * Uses SubtleCrypto SHA-256 for domain separation.
 */
async function deriveChatKey(
  myPrivateKeyHex: string,
  theirPublicKeyHex: string,
  chatId: string,
): Promise<Uint8Array> {
  const sharedSecret = deriveSharedSecret(myPrivateKeyHex, theirPublicKeyHex)
  // SHA-256(shared_secret || chat_id) → 32 bytes
  const data = new Uint8Array([...sharedSecret, ...new TextEncoder().encode(chatId)])
  const hash = await crypto.subtle.digest("SHA-256", data)
  return new Uint8Array(hash)
}


// ─── Encrypt / Decrypt ───

/**
 * Encrypt a plaintext message for a 1-on-1 chat.
 */
export async function encryptMessage(
  plaintext: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  chatId: string,
  senderId: string,
): Promise<EncryptedEnvelope> {
  const symmetricKey = await deriveChatKey(
    myKeys.privateKeyHex,
    theirPublicKeyHex,
    chatId,
  )
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const messageBytes = new TextEncoder().encode(plaintext)
  const ciphertext = nacl.secretbox(messageBytes, nonce, symmetricKey)
  // Prepend nonce to ciphertext for storage
  const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
  ciphertextWithNonce.set(nonce)
  ciphertextWithNonce.set(ciphertext, nonce.length)
  // Sign the plaintext
  const signature = nacl.sign.detached(
    messageBytes,
    hexToBytes(myKeys.signingPrivateHex),
  )
  return {
    ciphertext: base64Encode(ciphertextWithNonce.buffer as ArrayBuffer),
    signature: base64Encode(signature.buffer as ArrayBuffer),
    timestamp: Date.now(),
    senderId,
  }
}

/**
 * Decrypt a message from a 1-on-1 chat.
 */
export async function decryptMessage(
  envelope: EncryptedEnvelope,
  myKeys: E2EKeys,
  senderPublicKeyHex: string,
  chatId: string,
): Promise<string | null> {
  try {
    const symmetricKey = await deriveChatKey(
      myKeys.privateKeyHex,
      senderPublicKeyHex,
      chatId,
    )
    const ciphertextBytes = new Uint8Array(base64Decode(envelope.ciphertext))
    const nonce = ciphertextBytes.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = ciphertextBytes.subarray(nacl.secretbox.nonceLength)
    const plaintext = nacl.secretbox.open(ciphertext, nonce, symmetricKey)
    if (!plaintext) return null
    // Verify signature
    const messageBytes = new Uint8Array(plaintext)
    const signatureBytes = new Uint8Array(base64Decode(envelope.signature))
    const valid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      hexToBytes(senderPublicKeyHex),
    )
    return valid ? new TextDecoder().decode(plaintext) : null
  } catch {
    return null
  }
}

/**
 * Encrypt a message for a group chat using the group symmetric key.
 */
export function encryptGroupMessage(
  plaintext: string,
  myKeys: E2EKeys,
  groupKey: Uint8Array,
  senderId: string,
): EncryptedEnvelope {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const messageBytes = new TextEncoder().encode(plaintext)
  const ciphertext = nacl.secretbox(messageBytes, nonce, groupKey)
  const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
  ciphertextWithNonce.set(nonce)
  ciphertextWithNonce.set(ciphertext, nonce.length)
  const signature = nacl.sign.detached(
    messageBytes,
    hexToBytes(myKeys.signingPrivateHex),
  )
  return {
    ciphertext: base64Encode(ciphertextWithNonce.buffer as ArrayBuffer),
    signature: base64Encode(signature.buffer as ArrayBuffer),
    timestamp: Date.now(),
    senderId,
  }
}

/**
 * Decrypt a group chat message using the group symmetric key.
 */
export function decryptGroupMessage(
  envelope: EncryptedEnvelope,
  groupKey: Uint8Array,
): string | null {
  try {
    const ciphertextBytes = new Uint8Array(base64Decode(envelope.ciphertext))
    const nonce = ciphertextBytes.subarray(0, nacl.secretbox.nonceLength)
    const ciphertext = ciphertextBytes.subarray(nacl.secretbox.nonceLength)
    const plaintext = nacl.secretbox.open(ciphertext, nonce, groupKey)
    return plaintext ? new TextDecoder().decode(new Uint8Array(plaintext)) : null
  } catch {
    return null
  }
}

// ─── Chat Key Cache ───

const chatKeyCache = new Map<string, { key: Uint8Array; peerPub: string }>()

export function getCachedChatKey(chatId: string): { key: Uint8Array; peerPub: string } | undefined {
  return chatKeyCache.get(chatId)
}

export function setCachedChatKey(chatId: string, key: Uint8Array, peerPub: string) {
  chatKeyCache.set(chatId, { key, peerPub })
}

export async function getOrCreateChatKey(
  chatId: string,
  isGroup: boolean,
  participants: Array<{ id: string; public_key?: string }>,
  myId: string,
  myKeys: E2EKeys,
): Promise<Uint8Array> {
  const cached = chatKeyCache.get(chatId)
  if (cached) return cached.key

  if (!isGroup) {
    const peer = participants.find((p) => p.id !== myId)
    if (!peer?.public_key) throw new Error("Peer public key not found — E2E not available")
    const key = await deriveChatKey(myKeys.privateKeyHex, peer.public_key, chatId)
    chatKeyCache.set(chatId, { key, peerPub: peer.public_key })
    return key
  }

  // Group: group key should be fetched from chat metadata
  throw new Error("Group key not loaded — call loadGroupKey first")
}

// ─── E2E Eligibility Check ───

export function isE2EEnabled(
  participants: Array<{ id: string; public_key?: string }>,
  myKeys: E2EKeys | null,
): boolean {
  if (!myKeys) return false
  return participants.every((p) => !!p.public_key)
}

// ─── Key Rotation ───

export async function rotateE2EKeys(): Promise<E2EKeys> {
  // Generate new X25519 keypair
  const boxKp = nacl.box.keyPair()
  // Generate new Ed25519 signing keypair
  const signKp = nacl.sign.keyPair()

  const newKeys: E2EKeys = {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
  saveKeys(newKeys)
  chatKeyCache.clear()
  return newKeys
}
