import nacl from "tweetnacl"
import {
  encode as base64Encode,
  decode as base64Decode,
} from "base64-arraybuffer"
import { DoubleRatchetSession, type RatchetEnvelope, type SerializedSession } from "./doubleRatchet"
import { api } from "./api"

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
const DEVICE_SECRET_KEY = "device_secret"

function _deriveStorageKey(): Uint8Array {
  let secret = localStorage.getItem(DEVICE_SECRET_KEY)
  if (!secret) {
    secret = bytesToHex(nacl.randomBytes(32))
    localStorage.setItem(DEVICE_SECRET_KEY, secret)
  }
  const hash = nacl.hash(new TextEncoder().encode(secret))
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

// ─── Pre-Key Management (SPK / OPK) ───

const SPK_STORAGE_KEY = "e2e_spk"
const OPK_STORAGE_KEY = "e2e_opks"

export interface StoredSPK {
  publicKeyHex: string
  secretKeyHex: string
  signatureHex: string
}

export function loadSPK(): StoredSPK | null {
  try {
    const raw = localStorage.getItem(SPK_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSPK(spk: StoredSPK) {
  localStorage.setItem(SPK_STORAGE_KEY, JSON.stringify(spk))
}

export function loadOPKs(): string[] {
  try {
    const raw = localStorage.getItem(OPK_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveOPKs(keys: string[]) {
  localStorage.setItem(OPK_STORAGE_KEY, JSON.stringify(keys))
}

export function removeOPK(pubHex: string) {
  const keys = loadOPKs().filter((k) => k !== pubHex)
  saveOPKs(keys)
}

export async function setupPreKeys(myKeys: E2EKeys): Promise<void> {
  const existing = loadSPK()
  if (existing) return

  const spkKp = nacl.box.keyPair()
  const spkPubHex = bytesToHex(spkKp.publicKey)
  const spkSecHex = bytesToHex(spkKp.secretKey)
  const signature = nacl.sign.detached(
    spkKp.publicKey,
    hexToBytes(myKeys.signingPrivateHex),
  )
  const sigHex = bytesToHex(signature)

  try {
    await api.uploadSignedPrekey(spkPubHex, sigHex)
    saveSPK({ publicKeyHex: spkPubHex, secretKeyHex: spkSecHex, signatureHex: sigHex })
  } catch (err) {
    console.warn("[E2E] Failed to upload SPK:", err)
  }

  try {
    const opkCount = await api.getOneTimePrekeyCount(myKeys.publicKeyHex)
    if (opkCount.count < 20) {
      await api.uploadOneTimePrekeys(100)
    }
  } catch (err) {
    console.warn("[E2E] Failed to upload OPKs:", err)
  }
}

export async function fetchAndVerifyBundle(
  userId: string,
): Promise<{ signedPrekeyHex: string; oneTimePrekeyHex?: string } | null> {
  try {
    const bundle = await api.getBundle(userId)

    const sigValid = nacl.sign.detached.verify(
      hexToBytes(bundle.signed_prekey),
      hexToBytes(bundle.signed_prekey_signature),
      hexToBytes(bundle.identity_key),
    )
    if (!sigValid) {
      console.warn("[E2E] SPK signature verification failed for", userId)
      return null
    }

    return {
      signedPrekeyHex: bundle.signed_prekey,
      oneTimePrekeyHex: bundle.one_time_prekey ?? undefined,
    }
  } catch (err) {
    console.warn("[E2E] Failed to fetch bundle for", userId, err)
    return null
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
    let spkHex = theirSignedPrekeyHex
    let otpkHex = theirOneTimePrekeyHex

    if (!spkHex) {
      const bundle = await fetchAndVerifyBundle(theirPublicKeyHex)
      if (bundle) {
        spkHex = bundle.signedPrekeyHex
        otpkHex = bundle.oneTimePrekeyHex
      } else {
        spkHex = theirPublicKeyHex
      }
    }

    session = new DoubleRatchetSession()
    await session.initializeAsAlice({
      ourIdentitySecret: hexToBytes(myKeys.privateKeyHex),
      theirIdentityPublic: hexToBytes(theirPublicKeyHex),
      theirSignedPrekeyPublic: hexToBytes(spkHex),
      theirOneTimePrekeyPublic: otpkHex ? hexToBytes(otpkHex) : undefined,
    })
  } else {
    const spk = loadSPK()
    const spkSecret = spk ? hexToBytes(spk.secretKeyHex) : hexToBytes(myKeys.privateKeyHex)

    session = new DoubleRatchetSession()
    await session.initializeAsBob({
      ourIdentitySecret: hexToBytes(myKeys.privateKeyHex),
      ourSignedPrekeySecret: spkSecret,
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
      const spk = loadSPK()
      const spkSecret = spk ? hexToBytes(spk.secretKeyHex) : hexToBytes(myKeys.privateKeyHex)

      session = new DoubleRatchetSession()
      await session.initializeAsBob({
        ourIdentitySecret: hexToBytes(myKeys.privateKeyHex),
        ourSignedPrekeySecret: spkSecret,
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
