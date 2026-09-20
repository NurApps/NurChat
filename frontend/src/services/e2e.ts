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

// ─── Padding (hide plaintext length from relay) ───
// Before encryption we pad to the next 512B bucket: [4B BE len][plain][random tail].
// Relay sees only bucketed ciphertext size ("да"/"нет" are indistinguishable
// from a paragraph). Decrypt tries to unpad; pre-512 legacy 128B buckets and
// unpadded messages fall back gracefully (see unpadBytes).
const PAD_BLOCK = 512
const LEGACY_PAD_BLOCK = 128
export function padBytes(plain: Uint8Array): Uint8Array {
  const paddedLen = Math.ceil((plain.length + 4) / PAD_BLOCK) * PAD_BLOCK
  const out = new Uint8Array(paddedLen)
  new DataView(out.buffer).setUint32(0, plain.length, false)
  out.set(plain, 4)
  if (paddedLen > plain.length + 4) {
    const tail = out.subarray(plain.length + 4)
    const rnd = randomBytes(tail.length)
    tail.set(rnd)
  }
  return out
}
export function unpadBytes(padded: Uint8Array): Uint8Array | null {
  if (padded.length < 4) return null
  if (padded.length % PAD_BLOCK !== 0 && padded.length % LEGACY_PAD_BLOCK !== 0) return null
  const len = new DataView(padded.buffer, padded.byteOffset, 4).getUint32(0, false)
  if (len > padded.length - 4 || len > 8192) return null
  return padded.subarray(4, 4 + len)
}
function padString(plain: string): string {
  const plainBytes = new TextEncoder().encode(plain)
  const padded = padBytes(plainBytes)
  return base64Encode(padded.buffer as ArrayBuffer)
}
function unpadString(maybeB64: string): string | null {
  try {
    const padded = new Uint8Array(base64Decode(maybeB64))
    const plain = unpadBytes(padded)
    return plain ? new TextDecoder().decode(plain) : null
  } catch {
    return null
  }
}

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

// ─── Safety Numbers (contact verification) ───

import { sha256 } from "@noble/hashes/sha2.js"

function u8Concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arrays) total += a.length
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function u8Compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return a.length - b.length
}

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

/**
 * True when the stored SPK was signed by the CURRENT identity signing key.
 * After re-registration or key rotation in the same browser profile the
 * IndexedDB copy belongs to a previous identity: the server (which checks
 * against the current signing_public_key) answers 400 "Invalid SPK
 * signature", and trusting it would mean bundle 404 forever.
 */
function spkMatchesIdentity(spk: StoredSPK, myKeys: E2EKeys): boolean {
  try {
    return signVerify(
      hexToBytesSecure(spk.publicKeyHex),
      hexToBytesSecure(spk.signatureHex),
      hexToBytesSecure(myKeys.signingPublicHex),
    )
  } catch {
    return false
  }
}

export async function setupPreKeys(myKeys: E2EKeys): Promise<void> {
  const existing = await loadSPKFromStorage()
  if (existing) {
    if (spkMatchesIdentity(existing, myKeys)) return
    console.warn("[E2E] local SPK not signed by current identity — regenerating")
  }

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

// IDs already probed by ensurePreKeysUploaded in this page session.
const ensureAttempted = new Set<string>()

/**
 * Self-heal for missing server-side SPK (bundle 404 for new contacts).
 *
 * setupPreKeys() skips when a LOCAL SPK exists — but the server copy can be
 * gone (DB move/wipe, Supabase switch, failed first upload on a stayed
 * logged-in session). Then every new contact gets "User has no signed
 * pre-key" and falls back to identity-as-SPK sessions that the peer cannot
 * always reproduce ("Decryption failed" forever).
 *
 * Uses the side-effect-free GET /signed-prekey (unlike bundle, it does NOT
 * claim an OPK). Re-uploads only on 404 — never on network errors, to avoid
 * spurious SPK rotation (which would break peers' live sessions).
 */
export async function ensurePreKeysUploaded(myKeys: E2EKeys, ownUserId: string): Promise<void> {
  // One attempt per page session: the endpoint is rate-limited (10/min) and
  // ChatPage remounts would otherwise burn the quota with 404→upload loops.
  if (ensureAttempted.has(ownUserId)) return
  ensureAttempted.add(ownUserId)

  const local = await loadSPKFromStorage()
  if (!local || !spkMatchesIdentity(local, myKeys)) {
    // Never uploaded, or stale copy from a previous identity in this
    // profile (re-uploading it yields 400 "Invalid SPK signature").
    await setupPreKeys(myKeys)
    return
  }
  let serverHasSpk = false
  try {
    const spk = await api.getSignedPrekey(ownUserId)
    serverHasSpk = !!spk?.public_key
  } catch (err) {
    const status = (err as { status?: number })?.status
    const msg = err instanceof Error ? err.message : String(err)
    if (status !== 404 && !msg.includes("No signed pre-key")) {
      // Network/auth error — do NOT rotate SPK on a guess.
      console.warn("[E2E] SPK check failed (keeping local SPK):", err)
      return
    }
  }
  if (!serverHasSpk) {
    console.warn("[E2E] SPK missing on server, re-uploading local SPK")
    try {
      await api.uploadSignedPrekey(local.publicKeyHex, local.signatureHex)
    } catch (err) {
      console.warn("[E2E] SPK re-upload failed:", err)
    }
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
// Memory-only plaintext of foreign messages already decrypted (key: chatId:msgId).
// History reloads and live WS handlers share one session: without this, the
// second consumer re-decrypts the same envelope and hits "message in the past"
// (chain already advanced), replacing good text with "[не удалось расшифровать]".
// Cleared together with sessions (logout / auto-clear / rotate). Never persisted.
const decryptedCache = new Map<string, string>()
function clearDecryptedCache(): void {
  decryptedCache.clear()
}

export async function getOrCreateSession(
  chatId: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  isInitiator: boolean,
  theirUserId?: string,
  theirSignedPrekeyHex?: string,
): Promise<DoubleRatchetSession> {
  resetAutoClearTimer()

  const cached = sessionCache.get(chatId)
  if (cached) return cached

  let session: DoubleRatchetSession

  if (isInitiator) {
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
  clearDecryptedCache()
  await clearSessionsSecure()
}

async function persistSessions(): Promise<void> {
  const data: Record<string, SerializedSession> = {}
  for (const [chatId, session] of sessionCache) {
    data[chatId] = session.serialize()
  }
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

// ─── Encrypt / Decrypt with Double Ratchet ───

export async function encryptMessage(
  plaintext: string,
  myKeys: E2EKeys,
  theirPublicKeyHex: string,
  chatId: string,
  senderId: string,
  theirUserId?: string,
): Promise<EncryptedEnvelope> {
  resetAutoClearTimer()

  const session = await getOrCreateSession(chatId, myKeys, theirPublicKeyHex, true, theirUserId)
  const envelope = await session.encryptMessage(padString(plaintext))
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
  msgId?: string,
): Promise<string | null> {
  resetAutoClearTimer()

  // Second consumer for the same envelope (live WS + history reload share
  // one session): serve from memory instead of advancing the chain twice.
  const cacheKey = msgId ? `${chatId}:${msgId}` : null
  if (cacheKey) {
    const cached = decryptedCache.get(cacheKey)
    if (cached !== undefined) return cached
  }

  try {
    const ratchetEnvelope: RatchetEnvelope = JSON.parse(envelope.ciphertext)
    let session = getSession(chatId)
    if (!session) {
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
    const raw = await session.decryptMessage(ratchetEnvelope)
    // New messages are padded base64; legacy messages are raw plaintext.
    const maybe = unpadString(raw)
    const plaintext = maybe ?? raw
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
    if (cacheKey) decryptedCache.set(cacheKey, plaintext)
    return plaintext
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/Decryption failed|Associated data mismatch/.test(msg)) {
      // Likely stale session (peer re-registered/rotated, or a fallback
      // session built from a 404 bundle). Drop it so the next message
      // re-handshakes from a fresh bundle instead of failing forever.
      // "in the past"/replay errors are duplicates — session itself is fine.
      console.warn("[E2E] dropping stale session for chat", chatId, "after:", msg)
      removeSession(chatId)
    } else {
      console.warn("[E2E] decryptMessage failed:", err)
    }
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
    clearDecryptedCache()
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
  clearDecryptedCache()
  await clearSessionsSecure()
}
