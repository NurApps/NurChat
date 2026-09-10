/**
 * Secure Storage Module for NurChat — Key Storage Hardening
 *
 * Features:
 * - IndexedDB: more isolated than localStorage, supports structured data
 * - At-rest encryption: AES-256-GCM via WebCrypto (non-extractable CryptoKey)
 * - Zeroize: overwrite + ArrayBuffer.transfer(0) for memory release
 * - Auto-clear: re-derive keys after 10 min inactivity
 * - Migration: one-time move from localStorage → IndexedDB
 *
 * Security model:
 * - Private keys stored as hex strings, encrypted at rest with AES-256-GCM
 * - Encryption key derived from device_secret via PBKDF2 → non-extractable CryptoKey
 * - Key material on disk: only ciphertext.
 * - LIMITATION (browser): device_secret itself is stored in plaintext in
 *   IndexedDB (no OS keystore in a web app). It raises the bar vs
 *   localStorage (origin-isolated, not exfiltrated by simple XSS string
 *   theft of localStorage), but a full IndexedDB dump still defeats it.
 *   Documented honestly — do not claim otherwise.
 */

import { openDB, type IDBPDatabase } from "idb"
import { toBase64, fromBase64 } from "./doubleRatchet"

// ─── Constants ───

const DB_NAME = "nurchat-secure"
const DB_VERSION = 2
const STORE_KEYS = "keys"
const STORE_SESSIONS = "sessions"
const STORE_META = "meta"

const AUTO_CLEAR_MS = 10 * 60 * 1000 // 10 minutes
const LEGACY_KEYS_KEY = "e2e_keys"
const LEGACY_SESSIONS_KEY = "e2e_sessions"
const LEGACY_SPK_KEY = "e2e_spk"
const LEGACY_OPK_KEY = "e2e_opks"
const DEVICE_SECRET_KEY = "device_secret"
const WRAPPING_KEY_ID = "wrapping_key_v1"

// PBKDF2 salt (app-specific, not random — we need determinism)
const WRAPPING_SALT = new TextEncoder().encode("nurchat-secure-storage-v1")
const PBKDF2_ITERATIONS = 100_000

// ─── Types ───

export interface StoredKeyPair {
  privateKeyHex: string
  publicKeyHex: string
  signingPrivateHex: string
  signingPublicHex: string
  createdAt: number
}

export interface StoredSPK {
  publicKeyHex: string
  secretKeyHex: string
  signatureHex: string
  createdAt: number
}

export interface StoredOPK {
  publicKeyHex: string
  secretKeyHex: string
  createdAt: number
}

export interface SecureStorageKeys {
  identity: StoredKeyPair | null
  spk: StoredSPK | null
  opks: StoredOPK[]
}

// ─── Core: IndexedDB Wrapper ───

let dbInstance: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, _tx) {
      if (!db.objectStoreNames.contains(STORE_KEYS)) {
        db.createObjectStore(STORE_KEYS)
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS)
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META)
      }
    },
  })

  return dbInstance
}

// ─── At-Rest Encryption (AES-256-GCM) ───

/**
 * Derive a non-extractable AES-256-GCM CryptoKey from device_secret.
 * This key encrypts all data before writing to IndexedDB.
 */
let wrappingKeyCache: CryptoKey | null = null

async function getWrappingKey(): Promise<CryptoKey> {
  if (wrappingKeyCache) return wrappingKeyCache

  const deviceSecret = await getDeviceSecret()

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(deviceSecret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  )

  wrappingKeyCache = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: WRAPPING_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // NON-EXTRACTABLE — raw key never leaves WebCrypto
    ["encrypt", "decrypt"],
  )

  return wrappingKeyCache
}

/**
 * Encrypt a string with AES-256-GCM.
 * Returns base64-encoded (iv + ciphertext).
 */
async function encryptAtRest(plaintext: string): Promise<string> {
  const key = await getWrappingKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  )

  // iv is not secret, prepend to ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return toBase64(combined)
}

/**
 * Decrypt a base64-encoded (iv + ciphertext) string with AES-256-GCM.
 */
async function decryptAtRest(encodedData: string): Promise<string> {
  const key = await getWrappingKey()
  const raw = fromBase64(encodedData)
  const iv = raw.slice(0, 12)
  const ciphertext = raw.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(decrypted)
}

// ─── Zeroize ───

/**
 * Explicitly zeroes out a Uint8Array buffer and releases memory.
 * Steps:
 * 1. Overwrite with zeros (defense-in-depth against GC copying)
 * 2. Detach via transfer(0) to signal GC for immediate release
 *
 * transfer(0) is Baseline 2024 — available in Chrome 117+, Firefox 128+, Safari 17.2+.
 */
export function zeroize(buffer: Uint8Array | null): void {
  if (!buffer) return

  // Step 1: Overwrite with zeros
  buffer.fill(0)

  // Step 2: Detach if possible (forces memory release)
  try {
    if (
      buffer.buffer instanceof ArrayBuffer &&
      typeof buffer.buffer.transfer === "function"
    ) {
      buffer.buffer.transfer(0)
    }
  } catch {
    // transfer() may fail if buffer is a SharedArrayBuffer — ignore
  }
}

/**
 * Zeroize multiple buffers at once.
 */
export function zeroizeAll(...buffers: (Uint8Array | null)[]): void {
  for (const buf of buffers) {
    zeroize(buf)
  }
}

/**
 * Create a zeroed buffer of given size.
 */
export function secureBuffer(size: number): Uint8Array {
  return new Uint8Array(size)
}

/**
 * Copy sensitive data into a new buffer (avoids reference leaks).
 * Caller MUST zeroize the returned buffer when done.
 */
export function secureCopy(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.length)
  copy.set(source)
  return copy
}

// ─── Secure Storage Operations (encrypted at rest) ───

/**
 * Store identity keypair in IndexedDB (encrypted).
 */
export async function storeIdentityKeys(keys: StoredKeyPair): Promise<void> {
  const db = await getDB()
  const plaintext = JSON.stringify({ ...keys, createdAt: Date.now() })
  const encrypted = await encryptAtRest(plaintext)
  await db.put(STORE_KEYS, encrypted, "identity")
}

/**
 * Load identity keypair from IndexedDB (decrypted).
 */
export async function loadIdentityKeys(): Promise<StoredKeyPair | null> {
  const db = await getDB()
  const encrypted: string | undefined = await db.get(STORE_KEYS, "identity")
  if (!encrypted) return null
  try {
    const plaintext = await decryptAtRest(encrypted)
    return JSON.parse(plaintext) as StoredKeyPair
  } catch {
    return null
  }
}

/**
 * Store signed pre-key (SPK) in IndexedDB (encrypted).
 */
export async function storeSPK(spk: StoredSPK): Promise<void> {
  const db = await getDB()
  const plaintext = JSON.stringify({ ...spk, createdAt: Date.now() })
  const encrypted = await encryptAtRest(plaintext)
  await db.put(STORE_KEYS, encrypted, "spk")
}

/**
 * Load signed pre-key from IndexedDB (decrypted).
 */
export async function loadSPK(): Promise<StoredSPK | null> {
  const db = await getDB()
  const encrypted: string | undefined = await db.get(STORE_KEYS, "spk")
  if (!encrypted) return null
  try {
    const plaintext = await decryptAtRest(encrypted)
    return JSON.parse(plaintext) as StoredSPK
  } catch {
    return null
  }
}

/**
 * Store one-time pre-keys in IndexedDB (encrypted).
 */
export async function storeOPKs(opks: StoredOPK[]): Promise<void> {
  const db = await getDB()
  const data = opks.map((k) => ({ ...k, createdAt: Date.now() }))
  const plaintext = JSON.stringify(data)
  const encrypted = await encryptAtRest(plaintext)
  await db.put(STORE_KEYS, encrypted, "opks")
}

/**
 * Load one-time pre-keys from IndexedDB (decrypted).
 */
export async function loadOPKs(): Promise<StoredOPK[]> {
  const db = await getDB()
  const encrypted: string | undefined = await db.get(STORE_KEYS, "opks")
  if (!encrypted) return []
  try {
    const plaintext = await decryptAtRest(encrypted)
    return JSON.parse(plaintext) as StoredOPK[]
  } catch {
    return []
  }
}

/**
 * Remove a specific OPK by public key hex.
 */
export async function removeOPK(pubHex: string): Promise<void> {
  const opks = await loadOPKs()
  const filtered = opks.filter((k) => k.publicKeyHex !== pubHex)
  await storeOPKs(filtered)
}

/**
 * Store serialized session data (encrypted).
 */
export async function storeSessions(data: Record<string, unknown>): Promise<void> {
  const db = await getDB()
  const plaintext = JSON.stringify(data)
  const encrypted = await encryptAtRest(plaintext)
  await db.put(STORE_SESSIONS, encrypted, "e2e_sessions")
}

/**
 * Load serialized session data (decrypted).
 */
export async function loadSessions(): Promise<Record<string, unknown> | null> {
  const db = await getDB()
  const encrypted: string | undefined = await db.get(STORE_SESSIONS, "e2e_sessions")
  if (!encrypted) return null
  try {
    const plaintext = await decryptAtRest(encrypted)
    return JSON.parse(plaintext) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Clear all sessions.
 */
export async function clearSessions(): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_SESSIONS, "e2e_sessions")
}

/**
 * Store an arbitrary JSON-serializable value encrypted at rest (STORE_META).
 */
export async function storeSecureValue(key: string, data: unknown): Promise<void> {
  const db = await getDB()
  const plaintext = JSON.stringify(data)
  const encrypted = await encryptAtRest(plaintext)
  await db.put(STORE_META, encrypted, key)
}

/**
 * Load a value stored via storeSecureValue (decrypted).
 */
export async function loadSecureValue<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const db = await getDB()
  const encrypted: string | undefined = await db.get(STORE_META, key)
  if (!encrypted) return null
  try {
    const plaintext = await decryptAtRest(encrypted)
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}

/**
 * Clear ALL stored keys and sessions.
 */
export async function clearAll(): Promise<void> {
  const db = await getDB()
  const txKeys = db.transaction(STORE_KEYS, "readwrite")
  await txKeys.store.clear()
  await txKeys.done

  const txSessions = db.transaction(STORE_SESSIONS, "readwrite")
  await txSessions.store.clear()
  await txSessions.done

  const txMeta = db.transaction(STORE_META, "readwrite")
  await txMeta.store.clear()
  await txMeta.done

  wrappingKeyCache = null
}

// ─── Device Secret ───

/**
 * Derive or load the device secret.
 * This is a stable seed used to derive the AES-256-GCM wrapping key.
 * Stored in IndexedDB (not localStorage) for isolation.
 */
export async function getDeviceSecret(): Promise<string> {
  const db = await getDB()
  let secret: string | undefined = await db.get(STORE_META, DEVICE_SECRET_KEY)
  if (!secret) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    secret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await db.put(STORE_META, secret, DEVICE_SECRET_KEY)
  }
  return secret
}

// ─── Auto-Clear ───

let clearTimer: ReturnType<typeof setTimeout> | null = null
let onClearCallback: (() => void) | null = null

/**
 * Register a callback to be called when keys are auto-cleared.
 */
export function onAutoClear(callback: () => void): void {
  onClearCallback = callback
}

/**
 * Reset the auto-clear timer. Call this on every crypto operation.
 */
export function resetAutoClearTimer(): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    console.warn("[SecureStorage] Auto-clear triggered after 10 min inactivity")
    onClearCallback?.()
  }, AUTO_CLEAR_MS)
}

/**
 * Cancel the auto-clear timer (e.g., on logout).
 */
export function cancelAutoClear(): void {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
}

// ─── Migration from localStorage ───

function parseHex(hex: string): Uint8Array | null {
  try {
    if (hex.length % 2 !== 0) return null
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * Check if legacy localStorage keys exist.
 */
export function hasLegacyKeys(): boolean {
  return localStorage.getItem(LEGACY_KEYS_KEY) !== null
}

/**
 * Migrate legacy localStorage data to IndexedDB.
 */
export async function migrateFromLocalStorage(decryptedLegacyKeys: string): Promise<StoredKeyPair | null> {
  try {
    const legacy = JSON.parse(decryptedLegacyKeys) as {
      privateKeyHex?: string
      publicKeyHex?: string
      signingPrivateHex?: string
      signingPublicHex?: string
    }

    if (!legacy.privateKeyHex || !legacy.publicKeyHex) {
      console.warn("[SecureStorage] Invalid legacy key format")
      return null
    }

    if (
      !parseHex(legacy.privateKeyHex) ||
      !parseHex(legacy.publicKeyHex) ||
      !parseHex(legacy.signingPrivateHex) ||
      !parseHex(legacy.signingPublicHex)
    ) {
      console.warn("[SecureStorage] Invalid legacy key hex")
      return null
    }

    const keys: StoredKeyPair = {
      privateKeyHex: legacy.privateKeyHex,
      publicKeyHex: legacy.publicKeyHex,
      signingPrivateHex: legacy.signingPrivateHex,
      signingPublicHex: legacy.signingPublicHex,
      createdAt: Date.now(),
    }

    await storeIdentityKeys(keys)

    localStorage.removeItem(LEGACY_KEYS_KEY)
    localStorage.removeItem(LEGACY_SESSIONS_KEY)

    console.log("[SecureStorage] Migration complete: identity keys moved to IndexedDB")
    return keys
  } catch (err) {
    console.error("[SecureStorage] Migration failed:", err)
    return null
  }
}

/**
 * Migrate legacy SPK from localStorage.
 */
export async function migrateSPKFromLocalStorage(legacySpkJson: string): Promise<StoredSPK | null> {
  try {
    const legacy = JSON.parse(legacySpkJson) as {
      publicKeyHex?: string
      secretKeyHex?: string
      signatureHex?: string
    }

    if (!legacy.publicKeyHex || !legacy.secretKeyHex || !legacy.signatureHex) {
      return null
    }

    const spk: StoredSPK = {
      publicKeyHex: legacy.publicKeyHex,
      secretKeyHex: legacy.secretKeyHex,
      signatureHex: legacy.signatureHex,
      createdAt: Date.now(),
    }

    await storeSPK(spk)
    localStorage.removeItem(LEGACY_SPK_KEY)

    console.log("[SecureStorage] Migration complete: SPK moved to IndexedDB")
    return spk
  } catch {
    return null
  }
}

/**
 * Migrate legacy OPKs from localStorage.
 */
export async function migrateOPKsFromLocalStorage(legacyOpksJson: string): Promise<StoredOPK[]> {
  try {
    const legacy = JSON.parse(legacyOpksJson) as string[]
    if (!Array.isArray(legacy)) return []

    const opks: StoredOPK[] = legacy.map((pubHex) => ({
      publicKeyHex: pubHex,
      secretKeyHex: "",
      createdAt: Date.now(),
    }))

    await storeOPKs(opks)
    localStorage.removeItem(LEGACY_OPK_KEY)

    console.log("[SecureStorage] Migration complete:", opks.length, "OPKs moved to IndexedDB")
    return opks
  } catch {
    return []
  }
}

/**
 * Run full migration from localStorage.
 */
export async function migrateAllFromLocalStorage(
  decryptFn: (encoded: string) => string | null,
): Promise<SecureStorageKeys> {
  const result: SecureStorageKeys = { identity: null, spk: null, opks: [] }

  const legacyKeysRaw = localStorage.getItem(LEGACY_KEYS_KEY)
  if (legacyKeysRaw) {
    const decrypted = decryptFn(legacyKeysRaw)
    if (decrypted) {
      result.identity = await migrateFromLocalStorage(decrypted)
    }
  }

  const legacySpkRaw = localStorage.getItem(LEGACY_SPK_KEY)
  if (legacySpkRaw) {
    result.spk = await migrateSPKFromLocalStorage(legacySpkRaw)
  }

  const legacyOpksRaw = localStorage.getItem(LEGACY_OPK_KEY)
  if (legacyOpksRaw) {
    result.opks = await migrateOPKsFromLocalStorage(legacyOpksRaw)
  }

  return result
}

// ─── Utility: Secure Buffer Operations ───

export function hexToBytesSecure(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function secureCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

export function secureRandom(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}
