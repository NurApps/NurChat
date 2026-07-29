import nacl from "tweetnacl"
import {
  encode as base64Encode,
  decode as base64Decode,
} from "base64-arraybuffer"
import { DoubleRatchetSession, type RatchetEnvelope, type SerializedSession } from "./doubleRatchet"

export type { RatchetEnvelope } from "./doubleRatchet"

export interface EncryptedEnvelope {
  ciphertext: string
  signature: string
  timestamp: number
  senderId: string
  senderSigningKey?: string
}

export interface E2EKeys {
  privateKeyHex: string
  publicKeyHex: string
  signingPrivateHex: string
  signingPublicHex: string
}

const KEYS_KEY = "e2e_keys"
const SESSIONS_KEY = "e2e_sessions"

function _deriveStorageKey(): Uint8Array {
  const token = localStorage.getItem("token") || ""
  const hash = nacl.hash(new TextEncoder().encode(token))
  return hash.slice(0, 32)
}

function _encryptPayload(plain: string): string {
  const key = _deriveStorageKey()
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const data = new TextEncoder().encode(plain)
  const box = nacl.secretbox(data, nonce, key)
  if (!box) return plain
  const combined = new Uint8Array(nonce.length + box.length)
  combined.set(nonce)
  combined.set(box, nonce.length)
  return base64Encode(combined.buffer as ArrayBuffer)
}

function _decryptPayload(encoded: string): string | null {
  try {
    const key = _deriveStorageKey()
    const combined = new Uint8Array(base64Decode(encoded))
    const nonce = combined.subarray(0, nacl.secretbox.nonceLength)
    const box = combined.subarray(nacl.secretbox.nonceLength)
    const plain = nacl.secretbox.open(box, nonce, key)
    return plain ? new TextDecoder().decode(new Uint8Array(plain)) : null
  } catch {
    return null
  }
}

export function loadKeys(): E2EKeys | null {
  try {
    const raw = localStorage.getItem(KEYS_KEY)
    if (!raw) return null
    const decrypted = _decryptPayload(raw)
    return decrypted ? JSON.parse(decrypted) : null
  } catch {
    return null
  }
}

export function saveKeys(keys: E2EKeys) {
  const plain = JSON.stringify(keys)
  const encrypted = _encryptPayload(plain)
  localStorage.setItem(KEYS_KEY, encrypted)
}

export function clearKeys() {
  localStorage.removeItem(KEYS_KEY)
  localStorage.removeItem(SESSIONS_KEY)
}

export function hasKeys(): boolean {
  return !!loadKeys()
}

export function generateKeys(): E2EKeys {
  const boxKp = nacl.box.keyPair()
  const signKp = nacl.sign.keyPair()
  return {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
}

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

// ─── Session Manager (Double Ratchet) ───

const sessionCache = new Map<string, DoubleRatchetSession>()

export async function getOrCreateSession(
  chatId: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  isInitiator: boolean,
  theirSignedPrekeyHex?: string,
  theirOneTimePrekeyHex?: string,
): Promise<DoubleRatchetSession> {
  const cached = sessionCache.get(chatId)
  if (cached) return cached

  let session: DoubleRatchetSession

  if (isInitiator) {
    session = new DoubleRatchetSession()
    await session.initializeAsAlice({
      ourIdentitySecret: hexToBytes(myKeys.privateKeyHex),
      theirIdentityPublic: hexToBytes(theirPublicKeyHex),
      theirSignedPrekeyPublic: hexToBytes(theirSignedPrekeyHex || theirPublicKeyHex),
      theirOneTimePrekeyPublic: theirOneTimePrekeyHex ? hexToBytes(theirOneTimePrekeyHex) : undefined,
    })
  } else {
    const prekeySecret = hexToBytes(myKeys.privateKeyHex)
    session = new DoubleRatchetSession()
    await session.initializeAsBob({
      ourIdentitySecret: prekeySecret,
      ourSignedPrekeySecret: prekeySecret,
      ourOneTimePrekeySecret: null,
      theirIdentityPublic: hexToBytes(theirPublicKeyHex),
      theirEphemeralPublic: hexToBytes(theirSignedPrekeyHex || theirPublicKeyHex),
    })
  }

  sessionCache.set(chatId, session)
  persistSessions()
  return session
}

export function getSession(chatId: string): DoubleRatchetSession | undefined {
  return sessionCache.get(chatId)
}

export function removeSession(chatId: string) {
  sessionCache.delete(chatId)
  persistSessions()
}

export function clearSessions() {
  sessionCache.clear()
  localStorage.removeItem(SESSIONS_KEY)
}

function persistSessions() {
  const data: Record<string, SerializedSession> = {}
  for (const [chatId, session] of sessionCache) {
    data[chatId] = session.serialize()
  }
  const plain = JSON.stringify(data)
  const encrypted = _encryptPayload(plain)
  localStorage.setItem(SESSIONS_KEY, encrypted)
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return
    const decrypted = _decryptPayload(raw)
    if (!decrypted) return
    const data: Record<string, SerializedSession> = JSON.parse(decrypted)
    for (const [chatId, serialized] of Object.entries(data)) {
      sessionCache.set(chatId, DoubleRatchetSession.deserialize(serialized))
    }
  } catch {
    // ignore corrupt data
  }
}
loadSessions()

// ─── Encrypt / Decrypt with Double Ratchet ───

export async function encryptMessage(
  plaintext: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  chatId: string,
  senderId: string,
): Promise<EncryptedEnvelope> {
  const session = await getOrCreateSession(chatId, myKeys, theirPublicKeyHex, true)
  const envelope = await session.encryptMessage(plaintext)
  const signature = nacl.sign.detached(
    new TextEncoder().encode(plaintext),
    hexToBytes(myKeys.signingPrivateHex),
  )
  persistSessions()
  return {
    ciphertext: JSON.stringify(envelope),
    signature: base64Encode(signature.buffer as ArrayBuffer),
    timestamp: Date.now(),
    senderId,
    senderSigningKey: myKeys.signingPublicHex,
  }
}

export async function decryptMessage(
  envelope: EncryptedEnvelope,
  myKeys: E2EKeys,
  senderPublicKeyHex: string,
  chatId: string,
): Promise<string | null> {
  try {
    const ratchetEnvelope: RatchetEnvelope = JSON.parse(envelope.ciphertext)
    let session = getSession(chatId)
    if (!session) {
      session = new DoubleRatchetSession()
      await session.initializeAsBob({
        ourIdentitySecret: hexToBytes(myKeys.privateKeyHex),
        ourSignedPrekeySecret: hexToBytes(myKeys.privateKeyHex),
        ourOneTimePrekeySecret: null,
        theirIdentityPublic: hexToBytes(senderPublicKeyHex),
        theirEphemeralPublic: hexToBytes(ratchetEnvelope.header.dh),
      })
      sessionCache.set(chatId, session)
    }
    const plaintext = await session.decryptMessage(ratchetEnvelope)
    persistSessions()
    if (envelope.senderSigningKey) {
      const sigBytes = new Uint8Array(base64Decode(envelope.signature))
      const valid = nacl.sign.detached.verify(
        new TextEncoder().encode(plaintext),
        sigBytes,
        hexToBytes(envelope.senderSigningKey),
      )
      if (!valid) return null
    }
    return plaintext
  } catch (err) {
    console.warn("[E2E] decryptMessage failed:", err)
    return null
  }
}

// ─── Group Message (legacy, kept for compatibility) ───

export function encryptGroupMessage(
  plaintext: string,
  myKeys: E2EKeys,
  groupKey: Uint8Array,
  senderId: string,
): { ciphertext: string; signature: string; timestamp: number; senderId: string } {
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

export function decryptGroupMessage(
  envelope: { ciphertext: string; signature: string; timestamp: number; senderId: string },
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

// ─── Key Rotation ───

export async function rotateE2EKeys(): Promise<E2EKeys> {
  clearSessions()
  const boxKp = nacl.box.keyPair()
  const signKp = nacl.sign.keyPair()
  const newKeys: E2EKeys = {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
  saveKeys(newKeys)
  return newKeys
}

export function isE2EEnabled(
  participants: Array<{ id: string; public_key?: string }>,
  myKeys: E2EKeys | null,
): boolean {
  if (!myKeys) return false
  return participants.every((p) => !!p.public_key)
}
