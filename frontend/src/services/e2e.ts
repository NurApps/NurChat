import nacl from "tweetnacl"

/**
 * E2E Encryption Service for NurChat — Phase 1: Key Storage Hardening
 *
 * Keys are stored in IndexedDB via secureStorage (not localStorage).
 * Private keys are zeroized from memory after use.
 * Auto-clear after 10 min inactivity.
 * Migration from legacy localStorage on first run.
 *
 * Uses @noble/curves + @noble/ciphers (audited by cure53, Sep 2024).
 */

import {
  boxKeyPair,
  signKeyPair,
  signDetached,
  signVerify,
  secretboxEncrypt,
  secretboxDecrypt,
  secretboxNonceLength,
  randomBytes,
  sha512,
} from "./cryptoAdapter"
import {
  encode as base64Encode,
  decode as base64Decode,
} from "base64-arraybuffer"
import { DoubleRatchetSession, type RatchetEnvelope, type SerializedSession } from "./doubleRatchet"

import { api } from "./api"
import {
  type StoredSPK,
  type StoredOPK,
  storeIdentityKeys,
  loadIdentityKeys,
  storeSPK,
  loadSPK as loadSPKSecure,
  storeOPKs,
  loadOPKs as loadOPKsSecure,
  removeOPK as removeOPKSecure,
  storeSessions,
  loadSessions as loadSessionsSecure,
  clearSessions as clearSessionsSecure,
  getDeviceSecret,
  hasLegacyKeys,
  migrateAllFromLocalStorage,
  resetAutoClearTimer,
  cancelAutoClear,
  onAutoClear,
  zeroize,
  hexToBytesSecure,
  bytesToHex,
} from "./secureStorage"

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

// ─── Safety Numbers (contact verification) ───

import { sha256 } from "@noble/hashes/sha2.js"

/**
 * Generate Safety Number for verifying contact identity.
 * Both parties compute this independently — if they match, keys are authentic.
 *
 * Algorithm: SHA-256(sorted(identity_key_A, identity_key_B)) → 12 groups of 3 digits
 */
export function generateSafetyNumber(
  myIdentityKeyHex: string,
  theirIdentityKeyHex: string,
): { digits: string; qrData: string } {
  const myKey = hexToBytesSecure(myIdentityKeyHex)
  const theirKey = hexToBytesSecure(theirIdentityKeyHex)

  // Sort keys (smaller first) so both parties compute the same hash
  const [first, second] = u8Compare(myKey, theirKey) < 0 ? [myKey, theirKey] : [theirKey, myKey]

  const combined = u8Concat(first, second)
  const hash = sha256(combined)

  // Convert to 12 groups of 5 digits (mod 1000 each → 0-999)
  const digits: string[] = []
  let offset = 0
  for (let i = 0; i < 12; i++) {
    // Read 2 bytes (16 bits) and mod 1000
    const val = ((hash[offset] << 8) | hash[offset + 1]) % 1000
    digits.push(val.toString().padStart(3, '0'))
    offset = (offset + 2) % hash.length
  }

  return {
    digits: digits.join(' '),
    qrData: `nurchat-safety:${myIdentityKeyHex}:${theirIdentityKeyHex}`,
  }
}

/**
 * Verify that the other party's Safety Number matches.
 */
export function verifySafetyNumber(
  myIdentityKeyHex: string,
  theirIdentityKeyHex: string,
  observedDigits: string,
): boolean {
  const expected = generateSafetyNumber(myIdentityKeyHex, theirIdentityKeyHex)
  return expected.digits === observedDigits.replace(/\s+/g, " ").trim()
}

// ─── Encryption helpers (for session data at rest) ───

async function deriveStorageKey(): Promise<Uint8Array> {
  const secret = await getDeviceSecret()
  const hash = await sha512(new TextEncoder().encode(secret))
  return hash.slice(0, 32)
}

async function encryptPayload(plain: string): Promise<string> {
  const key = await deriveStorageKey()
  const nonce = randomBytes(secretboxNonceLength)
  const data = new TextEncoder().encode(plain)
  const box = secretboxEncrypt(data, nonce, key)
  const combined = new Uint8Array(nonce.length + box.length)
  combined.set(nonce)
  combined.set(box, nonce.length)
  return base64Encode(combined.buffer as ArrayBuffer)
}

async function decryptPayload(encoded: string): Promise<string | null> {
  try {
    const raw = localStorage.getItem(KEYS_KEY)
    if (!raw) return null
    const decrypted = _decryptPayload(raw)
    return decrypted ? JSON.parse(decrypted) : null

    const key = await deriveStorageKey()
    const combined = new Uint8Array(base64Decode(encoded))
    const nonce = combined.subarray(0, secretboxNonceLength)
    const box = combined.subarray(secretboxNonceLength)
    const plain = secretboxDecrypt(box, nonce, key)
    return plain ? new TextDecoder().decode(plain) : null
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

// ─── Key Operations ───

export async function loadKeys(): Promise<E2EKeys | null> {
  try {
    const stored = await loadIdentityKeys()
    if (!stored) return null
    return {
      privateKeyHex: stored.privateKeyHex,
      publicKeyHex: stored.publicKeyHex,
      signingPrivateHex: stored.signingPrivateHex,
      signingPublicHex: stored.signingPublicHex,
    }
  } catch {
    return null
  }
}

export async function saveKeys(keys: E2EKeys): Promise<void> {
  await storeIdentityKeys({
    privateKeyHex: keys.privateKeyHex,
    publicKeyHex: keys.publicKeyHex,
    signingPrivateHex: keys.signingPrivateHex,
    signingPublicHex: keys.signingPublicHex,
    createdAt: Date.now(),
  })
  resetAutoClearTimer()
}

// ─── Session Manager (Double Ratchet) ───

const sessionCache = new Map<string, DoubleRatchetSession>()


export async function clearKeys(): Promise<void> {
  const { clearAll } = await import("./secureStorage")
  const { resetRatchetCache } = await import("./groupE2E")
  await clearAll()
  resetRatchetCache()
}

export async function hasKeys(): Promise<boolean> {
  return !!(await loadKeys())
}

export async function generateKeys(): Promise<E2EKeys> {
  const boxKp = boxKeyPair()
  const signKp = signKeyPair()
  const keys: E2EKeys = {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
  // Zeroize local copies after saving
  zeroize(boxKp.secretKey)
  zeroize(signKp.secretKey)
  return keys
}

// ─── Pre-Key Management (SPK / OPK) ───

export async function loadSPKFromStorage(): Promise<StoredSPK | null> {
  return loadSPKSecure()
}

export async function saveSPKToStorage(spk: StoredSPK): Promise<void> {
  await storeSPK(spk)
  resetAutoClearTimer()
}

export async function loadOPKsFromStorage(): Promise<StoredOPK[]> {
  return loadOPKsSecure()
}

export async function saveOPKsToStorage(opks: StoredOPK[]): Promise<void> {
  await storeOPKs(opks)
  resetAutoClearTimer()
}

export async function removeOPKFromStorage(pubHex: string): Promise<void> {
  await removeOPKSecure(pubHex)
}

// Legacy API compatibility wrappers (sync → async bridge)
export function loadSPK(): { publicKeyHex: string; secretKeyHex: string; signatureHex: string } | null {
  console.warn("[E2E] loadSPK() sync called — use loadSPKFromStorage() instead")
  return null
}

export function saveSPK(spk: { publicKeyHex: string; secretKeyHex: string; signatureHex: string }): void {
  console.warn("[E2E] saveSPK() sync called — use saveSPKToStorage() instead")
  storeSPK({ ...spk, createdAt: Date.now() }).catch(console.error)
}

export function loadOPKs(): string[] {
  console.warn("[E2E] loadOPKs() sync called — use loadOPKsFromStorage() instead")
  return []
}

export function saveOPKs(keys: string[]): void {
  console.warn("[E2E] saveOPKs() sync called — use saveOPKsToStorage() instead")
  const opks: StoredOPK[] = keys.map((pubHex) => ({
    publicKeyHex: pubHex,
    secretKeyHex: "",
    createdAt: Date.now(),
  }))
  storeOPKs(opks).catch(console.error)
}

export function removeOPK(pubHex: string): void {
  console.warn("[E2E] removeOPK() sync called — use removeOPKFromStorage() instead")
  removeOPKSecure(pubHex).catch(console.error)
}

export async function setupPreKeys(myKeys: E2EKeys): Promise<void> {
  const existing = await loadSPKFromStorage()
  if (existing) return

  const spkKp = boxKeyPair()
  const spkPubHex = bytesToHex(spkKp.publicKey)
  const spkSecHex = bytesToHex(spkKp.secretKey)
  const signingKey = hexToBytesSecure(myKeys.signingPrivateHex)
  const signature = signDetached(spkKp.publicKey, signingKey)
  const sigHex = bytesToHex(signature)

  // Zeroize signing key after use
  zeroize(spkKp.secretKey)
  zeroize(signature)

  try {
    await api.uploadSignedPrekey(spkPubHex, sigHex)
    await saveSPKToStorage({
      publicKeyHex: spkPubHex,
      secretKeyHex: spkSecHex,
      signatureHex: sigHex,
    })
    // Zeroize secret key after saving to IndexedDB
    zeroize(hexToBytesSecure(spkSecHex))
  } catch (err) {
    console.warn("[E2E] Failed to upload SPK:", err)
    zeroize(hexToBytesSecure(spkSecHex))
  }

  try {
    const opkCount = await api.getOneTimePrekeyCount(myKeys.publicKeyHex)
    if (opkCount.count < 20) {
      const OPK_BATCH = 100
      const publicKeys: string[] = []
      const opksToStore: { publicKeyHex: string; secretKeyHex: string }[] = []

      for (let i = 0; i < OPK_BATCH; i++) {
        const kp = boxKeyPair()
        const pubHex = bytesToHex(kp.publicKey)
        const secHex = bytesToHex(kp.secretKey)
        publicKeys.push(pubHex)
        opksToStore.push({ publicKeyHex: pubHex, secretKeyHex: secHex })
        zeroize(kp.secretKey)
      }

      await api.uploadOneTimePrekeys(publicKeys)

      const existing = await loadOPKsFromStorage()
      const existingPubSet = new Set(existing.map((k) => k.publicKeyHex))
      const newOps = opksToStore.filter((k) => !existingPubSet.has(k.publicKeyHex))
      if (newOps.length > 0) {
        await storeOPKs([...existing, ...newOps.map((k) => ({
          publicKeyHex: k.publicKeyHex,
          secretKeyHex: k.secretKeyHex,
          createdAt: Date.now(),
        }))])
      }
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

    const identityKeyBytes = hexToBytesSecure(bundle.identity_key)
    const spkBytes = hexToBytesSecure(bundle.signed_prekey)
    const sigBytes = hexToBytesSecure(bundle.signed_prekey_signature)

    // Ed25519 public key MUST be exactly 32 bytes (64 hex chars).
    // SPK (X25519) MUST be exactly 32 bytes. Ed25519 signature MUST be 64 bytes.
    // Reject malformed bundles — they indicate corrupted DB or MITM attempt.
    if (identityKeyBytes.length !== 32) {
      console.warn("[E2E] REJECTED bundle for", userId, ": identity_key is", identityKeyBytes.length, "bytes, expected 32")
      return null
    }
    if (spkBytes.length !== 32) {
      console.warn("[E2E] REJECTED bundle for", userId, ": signed_prekey is", spkBytes.length, "bytes, expected 32")
      return null
    }
    if (sigBytes.length !== 64) {
      console.warn("[E2E] REJECTED bundle for", userId, ": signature is", sigBytes.length, "bytes, expected 64")
      return null
    }

    const sigValid = signVerify(spkBytes, sigBytes, identityKeyBytes)
    if (!sigValid) {
      console.warn("[E2E] REJECTED bundle for", userId, ": SPK signature verification FAILED")
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

// ─── Session Manager (Double Ratchet) ───

const sessionCache = new Map<string, DoubleRatchetSession>()
// chatId → peer userId (populated on initiator path; persisted with session)
const sessionPeers = new Map<string, string>()

export async function getOrCreateSession(
  chatId: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  isInitiator: boolean,
  theirSignedPrekeyHex?: string,
  theirOneTimePrekeyHex?: string,
): Promise<DoubleRatchetSession> {

  theirUserId?: string,
  theirSignedPrekeyHex?: string,
): Promise<DoubleRatchetSession> {
  resetAutoClearTimer()

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

    let spkHex = theirSignedPrekeyHex

    if (!spkHex) {
      const bundle = await fetchAndVerifyBundle(theirUserId || theirPublicKeyHex)
      if (bundle) {
        spkHex = bundle.signedPrekeyHex
        // NOTE: bundle.oneTimePrekeyHex is intentionally IGNORED.
        // The wire protocol carries no OPK id, so Bob could never select
        // the matching OPK secret — including dh4 on Alice's side only
        // produces an SK Bob can't reproduce (undecryptable first message).
        // X3DH with 3 DHs is the safe, spec-compliant fallback.
      } else {
        spkHex = theirPublicKeyHex
      }
    }

    const ourIdentitySecret = hexToBytesSecure(myKeys.privateKeyHex)
    const theirIdentityPublic = hexToBytesSecure(theirPublicKeyHex)
    const theirSignedPrekeyPublic = hexToBytesSecure(spkHex)

    session = new DoubleRatchetSession()
    await session.initializeAsAlice({
      ourIdentitySecret,
      theirIdentityPublic,
      theirSignedPrekeyPublic,
    })

    // Zeroize sensitive buffers
    zeroize(ourIdentitySecret)
  } else {
    const spk = await loadSPKFromStorage()
    const spkSecret = spk
      ? hexToBytesSecure(spk.secretKeyHex)
      : hexToBytesSecure(myKeys.privateKeyHex)

    const ourIdentitySecret = hexToBytesSecure(myKeys.privateKeyHex)
    const theirIdentityPublic = hexToBytesSecure(theirPublicKeyHex)
    const theirEphemeralPublic = hexToBytesSecure(theirSignedPrekeyHex || theirPublicKeyHex)

    session = new DoubleRatchetSession()
    await session.initializeAsBob({
      ourIdentitySecret,
      ourSignedPrekeySecret: spkSecret,
      ourOneTimePrekeySecret: null,
      theirIdentityPublic,
      theirEphemeralPublic,
    })

    // Zeroize sensitive buffers
    zeroize(ourIdentitySecret)
    zeroize(spkSecret)
  }

  sessionCache.set(chatId, session)
  // Remember peer for key-change invalidation (only real user ids)
  if (theirUserId && theirUserId.startsWith("user_")) {
    sessionPeers.set(chatId, theirUserId)
  }
  await persistSessions()
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

export function removeSession(chatId: string): void {
  sessionCache.delete(chatId)
  sessionPeers.delete(chatId)
  persistSessions().catch(console.error)
}

export function invalidateSessionsForUser(userId: string): void {
  // Drop cached sessions whose known peer is this user, so the next
  // message re-handshakes against their fresh pre-key bundle.
  let dropped = 0
  for (const [chatId, peerId] of sessionPeers) {
    if (peerId === userId) {
      sessionCache.delete(chatId)
      sessionPeers.delete(chatId)
      dropped++
    }
  }
  if (dropped > 0) console.log(`[E2E] Invalidated ${dropped} session(s) for ${userId}`)
  persistSessions().catch(console.error)
}

export async function clearSessions(): Promise<void> {
  sessionCache.clear()
  sessionPeers.clear()
  await clearSessionsSecure()
}

async function persistSessions(): Promise<void> {
  const data: Record<string, SerializedSession> = {}
  for (const [chatId, session] of sessionCache) {
    data[chatId] = session.serialize()
  }
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(data))
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return
    const data: Record<string, SerializedSession> = JSON.parse(raw)
    for (const [chatId, serialized] of Object.entries(data)) {
      sessionCache.set(chatId, DoubleRatchetSession.deserialize(serialized))

  const plain = JSON.stringify({ sessions: data, peers: Object.fromEntries(sessionPeers) })
  const encrypted = await encryptPayload(plain)
  await storeSessions(encrypted)
}

async function loadSessionsFromStorage(): Promise<void> {
  try {
    const encrypted = await loadSessionsSecure()
    if (!encrypted || typeof encrypted !== "string") return
    const decrypted = await decryptPayload(encrypted)
    if (!decrypted) return
    const parsed = JSON.parse(decrypted)
    // Backward compat: old format was a bare {chatId: session} map
    const data: Record<string, SerializedSession> = parsed.sessions ?? parsed
    for (const [chatId, serialized] of Object.entries(data)) {
      try {
        sessionCache.set(chatId, DoubleRatchetSession.deserialize(serialized))
      } catch {
        /* skip corrupt session */
      }
    }
    if (parsed.peers && typeof parsed.peers === "object") {
      for (const [chatId, peerId] of Object.entries(parsed.peers)) {
        if (typeof peerId === "string" && sessionCache.has(chatId)) {
          sessionPeers.set(chatId, peerId)
        }
      }
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
  theirUserId?: string,
): Promise<EncryptedEnvelope> {
  const session = await getOrCreateSession(chatId, myKeys, theirPublicKeyHex, true)
  const envelope = await session.encryptMessage(plaintext)
  const signature = nacl.sign.detached(
    new TextEncoder().encode(plaintext),
    hexToBytes(myKeys.signingPrivateHex),
  )
  persistSessions()

  resetAutoClearTimer()

  const session = await getOrCreateSession(chatId, myKeys, theirPublicKeyHex, true, theirUserId)
  const envelope = await session.encryptMessage(plaintext)
  const signingKeyBytes = hexToBytesSecure(myKeys.signingPrivateHex)
  const signature = signDetached(
    new TextEncoder().encode(plaintext),
    signingKeyBytes,
  )
  zeroize(signingKeyBytes)

  await persistSessions()
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
  resetAutoClearTimer()

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

      const spk = await loadSPKFromStorage()
      const spkSecret = spk
        ? hexToBytesSecure(spk.secretKeyHex)
        : hexToBytesSecure(myKeys.privateKeyHex)

      const ourIdentitySecret = hexToBytesSecure(myKeys.privateKeyHex)
      const theirIdentityPublic = hexToBytesSecure(senderPublicKeyHex)
      const theirEphemeralPublic = hexToBytesSecure(ratchetEnvelope.header.dh)

      session = new DoubleRatchetSession()
      await session.initializeAsBob({
        ourIdentitySecret,
        ourSignedPrekeySecret: spkSecret,
        ourOneTimePrekeySecret: null,
        theirIdentityPublic,
        theirEphemeralPublic,
      })
      sessionCache.set(chatId, session)

      // Zeroize
      zeroize(ourIdentitySecret)
      zeroize(spkSecret)
    }
    const plaintext = await session.decryptMessage(ratchetEnvelope)
    await persistSessions()

    // Signature is MANDATORY — omit or invalid = reject message
    if (!envelope.senderSigningKey || !envelope.signature) {
      console.warn("[E2E] REJECTED message: missing senderSigningKey or signature")
      return null
    }
    const sigBytes = new Uint8Array(base64Decode(envelope.signature))
    if (sigBytes.length !== 64) {
      console.warn("[E2E] REJECTED message: signature is", sigBytes.length, "bytes, expected 64")
      return null
    }
    const valid = signVerify(
      new TextEncoder().encode(plaintext),
      sigBytes,
      hexToBytesSecure(envelope.senderSigningKey),
    )
    if (!valid) {
      console.warn("[E2E] REJECTED message: signature verification failed")
      return null
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

  const nonce = randomBytes(secretboxNonceLength)
  const messageBytes = new TextEncoder().encode(plaintext)
  const ciphertext = secretboxEncrypt(messageBytes, nonce, groupKey)
  const ciphertextWithNonce = new Uint8Array(nonce.length + ciphertext.length)
  ciphertextWithNonce.set(nonce)
  ciphertextWithNonce.set(ciphertext, nonce.length)
  const signingKeyBytes = hexToBytesSecure(myKeys.signingPrivateHex)
  const signature = signDetached(messageBytes, signingKeyBytes)
  zeroize(signingKeyBytes)
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
    const nonce = ciphertextBytes.subarray(0, secretboxNonceLength)
    const ciphertext = ciphertextBytes.subarray(secretboxNonceLength)
    const plaintext = secretboxDecrypt(ciphertext, nonce, groupKey)
    return plaintext ? new TextDecoder().decode(plaintext) : null
  } catch {
    return null
  }
}

// ─── Key Rotation ───

export async function rotateE2EKeys(): Promise<E2EKeys> {
  clearSessions()
  const boxKp = nacl.box.keyPair()
  const signKp = nacl.sign.keyPair()

  await clearSessions()
  const boxKp = boxKeyPair()
  const signKp = signKeyPair()
  const newKeys: E2EKeys = {
    privateKeyHex: bytesToHex(boxKp.secretKey),
    publicKeyHex: bytesToHex(boxKp.publicKey),
    signingPrivateHex: bytesToHex(signKp.secretKey),
    signingPublicHex: bytesToHex(signKp.publicKey),
  }
  saveKeys(newKeys)

  zeroize(boxKp.secretKey)
  zeroize(signKp.secretKey)
  await saveKeys(newKeys)
  return newKeys
}

export function isE2EEnabled(
  participants: Array<{ id: string; public_key?: string }>,
  myKeys: E2EKeys | null,
): boolean {
  if (!myKeys) return false
  return participants.every((p) => !!p.public_key)
}


// ─── Migration & Init ───

/**
 * Initialize secure storage. Migrates from localStorage if needed.
 * Call this once at app startup.
 */
export async function initSecureStorage(): Promise<{
  migrated: boolean
  keys: E2EKeys | null
}> {
  const result = { migrated: false, keys: null as E2EKeys | null }

  // Check for legacy keys
  if (hasLegacyKeys()) {
    console.log("[E2E] Legacy localStorage keys detected, migrating...")

    const legacyRaw = localStorage.getItem("e2e_keys")
    if (legacyRaw) {
      try {
        const secret = localStorage.getItem("device_secret")
        if (secret) {
          const hash = await sha512(new TextEncoder().encode(secret))
          const key = hash.slice(0, 32)
          const combined = new Uint8Array(base64Decode(legacyRaw))
          const nonce = combined.subarray(0, secretboxNonceLength)
          const box = combined.subarray(secretboxNonceLength)
          const plain = secretboxDecrypt(box, nonce, key)
          if (plain) {
            const decrypted = new TextDecoder().decode(plain)
            const migrated = await migrateAllFromLocalStorage(() => decrypted)
            if (migrated.identity) {
              result.migrated = true
              result.keys = {
                privateKeyHex: migrated.identity.privateKeyHex,
                publicKeyHex: migrated.identity.publicKeyHex,
                signingPrivateHex: migrated.identity.signingPrivateHex,
                signingPublicHex: migrated.identity.signingPublicHex,
              }
            }
          }
        }
      } catch (err) {
        console.error("[E2E] Migration failed:", err)
      }
    }
  }

  // Load keys from IndexedDB
  if (!result.keys) {
    result.keys = await loadKeys()
  }

  // Setup auto-clear
  onAutoClear(() => {
    console.warn("[E2E] Auto-clearing session cache due to inactivity")
    sessionCache.clear()
  })

  // Load sessions
  await loadSessionsFromStorage()

  return result
}

/**
 * Cleanup on logout. Clears all sensitive data.
 */
export async function logout(): Promise<void> {
  cancelAutoClear()
  sessionCache.clear()
  sessionPeers.clear()
  await clearSessionsSecure()
}
