/**
 * Token vault — mitigation for pentest #1 (JWT in localStorage).
 *
 * Before: `access+refresh` lived in localStorage forever — any XSS could
 * steal them with one `localStorage.getItem` and own the account, and the
 * access token persisted on disk indefinitely.
 *
 * Now:
 * - access token: memory ONLY, never written to any storage. Dies with the
 *   tab/process. A passive disk dump or a `localStorage`-scraping payload
 *   finds nothing.
 * - refresh token: memory first; persisted to localStorage ONLY so the
 *   session survives reloads (no silent SSO here). Still XSS-readable while
 *   persisted — stated honestly. Bounded by server-side rotation (each
 *   refresh revokes the previous token) and the 30-min access TTL.
 *
 * Why not HttpOnly cookies: the frontend (Vite :5173, Tauri webview) is
 * cross-site vs the relay (:8000), so Lax cookies are never sent on fetch,
 * and SameSite=None requires https (no localhost http dev). Cookies would
 * silently break auth outside same-origin prod. Revisit if the relay ever
 * serves the frontend same-origin.
 *
 * Migration: legacy `localStorage.token` (access JWT persisted by older
 * builds) is absorbed into memory once and then deleted from disk.
 */

import { namespacedLSKey } from "./profiles"

const LS_ACCESS = "token"
const LS_REFRESH_BASE = "refresh_token"
const LS_USER_BASE = "user"

let accessToken: string | null = null
let refreshToken: string | null = null
let migrated = false

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
    if (!refreshToken) {
      const legacyRt = readLS(namespacedLSKey(LS_REFRESH_BASE))
      if (legacyRt) refreshToken = legacyRt
    }
    // Legacy access JWT must not stay on disk: memory owns it now.
    // Refresh stays (reload survival) — see module doc.
    removeLS(LS_ACCESS)
  } catch { /* ignore */ }
}

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

/** Full session write (login/register/2FA-verify). */
export function setSession(access: string, refresh?: string | null): void {
  migrateOnce()
  accessToken = access
  if (refresh !== undefined) {
    refreshToken = refresh
    if (refresh) writeLS(namespacedLSKey(LS_REFRESH_BASE), refresh)
    else removeLS(namespacedLSKey(LS_REFRESH_BASE))
  }
}

/** Rotated access token after POST /refresh (refresh itself may rotate too). */
export function updateAfterRefresh(access: string, refresh?: string | null): void {
  accessToken = access
  if (refresh) {
    refreshToken = refresh
    writeLS(namespacedLSKey(LS_REFRESH_BASE), refresh)
  }
}

export function clearSession(): void {
  accessToken = null
  refreshToken = null
  removeLS(LS_ACCESS)
  removeLS(namespacedLSKey(LS_REFRESH_BASE))
  removeLS(namespacedLSKey(LS_USER_BASE))
}

/** Профиль пользователя активного аккаунта (JSON), с учётом неймспейса. */
export function readStoredUserRaw(): string | null {
  return readLS(namespacedLSKey(LS_USER_BASE))
}

export function writeStoredUserRaw(json: string): void {
  writeLS(namespacedLSKey(LS_USER_BASE), json)
}
