/**
 * PIN-lock: device-level gate AND crypto secret (wired, not decorative).
 *
 * Two layers:
 * 1. Gate hash (`pin_hash`): PBKDF2-SHA-256 100k + random 16B salt,
 *    format `v2$<salt-b64>$<hash-b64>`. Legacy `SHA-256(pin + static-salt)`
 *    hex entries are still accepted once, then upgraded to v2 on success.
 * 2. Crypto: on successful unlock the PIN is mixed into the secureStorage
 *    wrapping-key derivation (`setDevicePassphrase`) — an at-rest IndexedDB
 *    dump alone no longer decrypts E2E keys. Enabling/changing/disabling
 *    the PIN re-wraps the whole keystore (`rewrapSecureStorage`).
 *    Logout keeps the PIN (device-level) but drops the passphrase from
 *    memory (`lockCrypto`) — keys stay PIN-wrapped on disk.
 *
 * Honest limits: a 4-digit PIN is ~13 bits of entropy. PBKDF2-100k makes
 * each guess cost ~0.05–0.1s CPU, so casual access (lost unlocked-webview
 * dump, curious roommate) is stopped cold — but a targeted GPU brute-force
 * over 10k combinations is hours, not years. Longer PINs help linearly;
 * this is a theft-delay, not a vault.
 */

import {
  isPassphraseSet,
  lockSecureStorage,
  rewrapSecureStorage,
  setDevicePassphrase,
} from "./secureStorage"
import { repersistRefresh, unlockVault } from "./tokenVault"

const PIN_HASH_KEY = "pin_hash"
const PIN_ATTEMPTS_KEY = "pin_attempts"
const PIN_LOCKED_UNTIL_KEY = "pin_locked_until"
const MAX_ATTEMPTS = 3
const LOCKOUT_DURATION_MS = 30000
const GATE_ITERATIONS = 100_000

function bufToB64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function gateHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: GATE_ITERATIONS, hash: "SHA-256" },
    ikm,
    256,
  )
  return new Uint8Array(bits)
}

function isLegacyHash(stored: string): boolean {
  return !stored.includes("$") && /^[0-9a-f]{64}$/i.test(stored)
}

async function legacyVerify(pin: string, stored: string): Promise<boolean> {
  const data = new TextEncoder().encode(pin + "nurchat_pin_salt")
  const digest = await crypto.subtle.digest("SHA-256", data)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  if (hex.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ stored.charCodeAt(i)
  return diff === 0
}

export async function setPin(pin: string): Promise<void> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await gateHash(pin, salt)
  localStorage.setItem(PIN_HASH_KEY, `v2$${bufToB64(salt)}$${bufToB64(hash)}`)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_HASH_KEY)
  if (!stored) return true
  if (isLegacyHash(stored)) {
    const ok = await legacyVerify(pin, stored)
    if (ok) await setPin(pin) // one-time upgrade to v2
    return ok
  }
  const parts = stored.split("$")
  if (parts.length !== 3 || parts[0] !== "v2") return false
  try {
    const salt = b64ToBuf(parts[1])
    const expected = b64ToBuf(parts[2])
    const actual = await gateHash(pin, salt)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
    return diff === 0
  } catch {
    return false
  }
}

export function isPinEnabled(): boolean {
  return !!localStorage.getItem(PIN_HASH_KEY)
}

export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

/** Storage is PIN-locked: gate set, but the passphrase isn't in memory. */
export function isStorageLocked(): boolean {
  return isPinEnabled() && !isPassphraseSet()
}

/**
 * Successful unlock: gate check + passphrase into memory.
 * Returns false without touching crypto state on a wrong PIN.
 */
export async function unlockWithPin(pin: string): Promise<boolean> {
  const ok = await verifyPin(pin)
  if (!ok) return false
  setDevicePassphrase(pin)
  // Retry vault decrypt with the new key (boot attempt ran keyless).
  await unlockVault()
  return true
}

/** Drop the passphrase from memory (logout, lockout). Keystore stays wrapped. */
export function lockCrypto(): void {
  setDevicePassphrase(null)
  lockSecureStorage()
}

/**
 * Enable PIN on previously unwrapped storage: re-wrap (null → pin),
 * persist the gate, activate the passphrase. Throws on rewrap failure —
 * gate is NOT stored then, storage keeps working as before.
 */
export async function enablePin(pin: string): Promise<void> {
  setDevicePassphrase(null) // start from the unwrapped key, whatever memory holds
  await rewrapSecureStorage(pin)
  await repersistRefresh()
  await setPin(pin)
  setDevicePassphrase(pin)
}

/**
 * Change PIN: caller proved the old one (verifyPin), re-wrap (old → new).
 * Returns false on wrong current PIN; throws on rewrap failure.
 */
export async function changePin(currentPin: string, newPin: string): Promise<boolean> {
  if (!(await verifyPin(currentPin))) return false
  setDevicePassphrase(currentPin)
  await rewrapSecureStorage(newPin)
  await repersistRefresh()
  await setPin(newPin)
  setDevicePassphrase(newPin)
  return true
}

/**
 * Disable PIN: re-wrap (pin → null), drop the gate and the passphrase.
 * Returns false on wrong PIN; throws on rewrap failure.
 */
export async function disablePin(pin: string): Promise<boolean> {
  if (!(await verifyPin(pin))) return false
  setDevicePassphrase(pin)
  await rewrapSecureStorage(null)
  await repersistRefresh()
  clearPin()
  setDevicePassphrase(null)
  return true
}

export function getRemainingAttempts(): number {
  const attempts = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10)
  return Math.max(0, MAX_ATTEMPTS - attempts)
}

export function recordFailedAttempt(): number {
  const attempts = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10) + 1
  localStorage.setItem(PIN_ATTEMPTS_KEY, String(attempts))
  if (attempts >= MAX_ATTEMPTS) {
    localStorage.setItem(PIN_LOCKED_UNTIL_KEY, String(Date.now() + LOCKOUT_DURATION_MS))
  }
  return MAX_ATTEMPTS - attempts
}

export function resetAttempts(): void {
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
}

export function getLockoutTimeRemaining(): number {
  const until = parseInt(localStorage.getItem(PIN_LOCKED_UNTIL_KEY) || "0", 10)
  const remaining = until - Date.now()
  return Math.max(0, remaining)
}

export function isLockedOut(): boolean {
  return getLockoutTimeRemaining() > 0
}
