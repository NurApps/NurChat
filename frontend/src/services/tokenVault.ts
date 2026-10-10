/**
 * Token vault — refresh at rest is ENCRYPTED (AES-256-GCM via the
 * secureStorage wrapping key: device_secret [+ PIN passphrase]), never
 * plaintext on disk.
 *
 * - access token: memory ONLY, never written to any storage. Dies with the
 *   tab/process. A passive disk dump or a `localStorage`-scraping payload
 *   finds nothing.
 * - refresh token: memory first; persisted as `v1$…` ciphertext in
 *   localStorage so the session survives reloads. Decrypted once per boot
 *   (`unlockVault`, async — key derivation needs IndexedDB). With a PIN set,
 *   the same PIN that wraps E2E keys wraps the refresh: no unlock, no session.
 *
 * Why not HttpOnly cookies: the frontend (Vite :5173, Tauri webview) is
 * cross-site vs the relay (:8000), so Lax cookies are never sent on fetch,
 * and SameSite=None requires https (no localhost http dev). Cookies would
 * silently break auth outside same-origin prod. Revisit if the relay ever
 * serves the frontend same-origin.
 *
 * Migration: legacy plaintext `refresh_token` (and ancient `token`) are
 * absorbed once — encrypted in place, plaintext deleted from disk.
 */

import { namespacedLSKey } from "./profiles"
import { decryptWithWrappingKey, encryptWithWrappingKey } from "./secureStorage"

const LS_ACCESS = "token"
const LS_REFRESH_BASE = "refresh_token"
const LS_REFRESH_CIPHER_BASE = "refresh_token_enc"
const LS_USER_BASE = "user"

let accessToken: string | null = null
let refreshToken: string | null = null
let migrated = false

// Boot readiness: resolved after the first unlock attempt settles
// (success OR failure — readiness is not success). Kicked at import so
// `vaultReady` always settles; retried after PIN unlock (see unlockVault).
let vaultReadyResolve: (() => void) | null = null
export const vaultReady: Promise<void> = new Promise((resolve) => {
  vaultReadyResolve = resolve
})
let unlockInFlight: Promise<void> | null = null
let unlockedOk = false

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* ignore (private mode etc.) */ }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

/** One-time migration of pre-vault leftovers from disk into memory. */
function migrateOnce(): void {
  if (migrated) return
  migrated = true
  try {
    if (!accessToken) {
      const legacy = readLS(LS_ACCESS)
      if (legacy) accessToken = legacy
    }
    // Legacy access JWT must not stay on disk: memory owns it now.
    // (Refresh plaintext migration is async — handled in unlockVault.)
    removeLS(LS_ACCESS)
  } catch { /* ignore */ }
}

function cipherKey(): string {
  return namespacedLSKey(LS_REFRESH_CIPHER_BASE)
}

function legacyKey(): string {
  return namespacedLSKey(LS_REFRESH_BASE)
}

async function doUnlock(): Promise<void> {
  migrateOnce()
  try {
    // Opportunistic: encrypt a legacy plaintext refresh in place.
    const legacy = readLS(legacyKey())
    if (legacy && !readLS(cipherKey())) {
      try {
        writeLS(cipherKey(), await encryptWithWrappingKey(legacy))
      } catch { /* locked or IDB down — retry next unlock */ }
    }
    if (legacy && readLS(cipherKey())) removeLS(legacyKey())
    if (!refreshToken) {
      const cipher = readLS(cipherKey())
      if (cipher) {
        try {
          refreshToken = await decryptWithWrappingKey(cipher)
          unlockedOk = true
        } catch { /* locked (PIN) or corrupt — session waits for unlock */ }
      } else {
        unlockedOk = true // nothing persisted: nothing to fail
      }
    } else {
      unlockedOk = true
    }
  } finally {
    vaultReadyResolve?.()
  }
}

/**
 * Decrypt the persisted refresh into memory. Idempotent while in flight;
 * re-runnable after PIN unlock (a failed attempt doesn't latch).
 * Call sites: boot (import side-effect below), PIN-unlock handlers,
 * and lazily at the top of refreshAccessToken().
 */
export function unlockVault(): Promise<void> {
  if (unlockedOk) return Promise.resolve()
  if (!unlockInFlight) {
    unlockInFlight = doUnlock().finally(() => {
      unlockInFlight = null
    })
  }
  return unlockInFlight
}

// Kick at import: vaultReady must settle even if no caller bothers.
void unlockVault()

export function getAccessToken(): string | null {
  migrateOnce()
  return accessToken
}

export function peekRefreshToken(): string | null {
  migrateOnce()
  return refreshToken
}

export function hasSession(): boolean {
  migrateOnce()
  return !!accessToken || !!refreshToken
}

/** Persisted (encrypted) session exists on disk — even if not yet unlocked. */
export function hasPersistedSession(): boolean {
  return readLS(cipherKey()) !== null || readLS(legacyKey()) !== null
}

/** Full session write (login/register/2FA-verify). Persists encrypted. */
export async function setSession(access: string, refresh?: string | null): Promise<void> {
  migrateOnce()
  accessToken = access
  if (refresh !== undefined) {
    refreshToken = refresh
    unlockedOk = true // memory is authoritative from here
    if (refresh) {
      try {
        writeLS(cipherKey(), await encryptWithWrappingKey(refresh))
        removeLS(legacyKey())
      } catch {
        // Fail-closed for disk, open for memory: session works until reload.
        // (IDB/private-mode failure — rare, logged, never plaintext.)
        console.warn("[vault] refresh persist failed, memory-only session")
        removeLS(cipherKey())
      }
    } else {
      removeLS(cipherKey())
      removeLS(legacyKey())
    }
  }
}

/** Rotated tokens after POST /refresh (refresh itself may rotate too). */
export async function updateAfterRefresh(access: string, refresh?: string | null): Promise<void> {
  accessToken = access
  if (refresh) {
    refreshToken = refresh
    unlockedOk = true
    try {
      writeLS(cipherKey(), await encryptWithWrappingKey(refresh))
      removeLS(legacyKey())
    } catch {
      console.warn("[vault] refresh persist failed, memory-only session")
      removeLS(cipherKey())
    }
  }
}

/**
 * Re-encrypt the in-memory refresh with the CURRENT wrapping key.
 * Called after PIN enable/change/disable rewrapped the keystore —
 * otherwise the persisted cipher stays on the OLD key and the next
 * boot unlock fails. No-op when memory holds no refresh.
 */
export async function repersistRefresh(): Promise<void> {
  if (!refreshToken) return
  try {
    writeLS(cipherKey(), await encryptWithWrappingKey(refreshToken))
  } catch {
    console.warn("[vault] refresh re-encrypt failed")
  }
}

export function clearSession(): void {
  accessToken = null
  refreshToken = null
  unlockedOk = false
  removeLS(LS_ACCESS)
  removeLS(cipherKey())
  removeLS(legacyKey())
  removeLS(namespacedLSKey(LS_USER_BASE))
}

/** Профиль пользователя активного аккаунта (JSON), с учётом неймспейса. */
export function readStoredUserRaw(): string | null {
  return readLS(namespacedLSKey(LS_USER_BASE))
}

export function writeStoredUserRaw(json: string): void {
  writeLS(namespacedLSKey(LS_USER_BASE), json)
}
