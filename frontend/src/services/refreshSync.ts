/**
 * Cross-tab refresh coordination — one tab refreshes, siblings adopt.
 *
 * Problem: two tabs share one refresh token (localStorage). Both 401
 * at once → both POST /refresh → rotation revokes the first → the loser
 * logs the user out. Server-side grace keeps the CHAIN alive, but the
 * loser tab still bounces to /login.
 *
 * Protocol (all best-effort, degrades to the old behaviour):
 * - localStorage lock `refresh_lock` {owner, exp}: only the holder POSTs.
 *   Lock/seq keys are profile-namespaced; values carry NO secrets.
 * - Winner shares the new tokens via BroadcastChannel (memory-to-memory,
 *   never on disk — access-JWT stays off localStorage per pentest #1),
 *   posted twice ~1s apart so a tab that subscribed late still catches it.
 * - Messages carry the active profile id; a tab adopts only its own
 *   profile's tokens (multi-account safety).
 * - Loser path: adopt-then-retry instead of logout. No sibling evidence
 *   (foreign lock / bumped seq) → fail fast, no artificial logout delay.
 */

import { getActiveProfileId, namespacedLSKey } from "./profiles"

const LOCK_TTL_MS = 15_000
const SIBLING_WAIT_MS = 6_000
const SIBLING_SHORT_WAIT_MS = 2_500
const ANNOUNCE_REPEAT_MS = 1_000
const BC_NAME = "nurchat:refresh"

interface RefreshLock {
  owner: string
  exp: number
}

export interface SiblingTokens {
  access: string
  refresh: string | null
}

// Random per-tab owner id (module scope = per tab).
const TAB_ID: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

let announceTimer: ReturnType<typeof setTimeout> | null = null

function lockKey(): string {
  return namespacedLSKey("refresh_lock")
}

function seqKey(): string {
  return namespacedLSKey("refresh_seq")
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readLock(): RefreshLock | null {
  try {
    const raw = readLS(lockKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RefreshLock>
    if (typeof parsed.owner !== "string" || typeof parsed.exp !== "number") return null
    return parsed as RefreshLock
  } catch {
    return null
  }
}

/** True when another tab demonstrably holds the lock right now. */
export function isSiblingRefreshing(): boolean {
  const lock = readLock()
  return !!lock && lock.owner !== TAB_ID && lock.exp > Date.now()
}

/**
 * Try to become THE tab that POSTs /refresh. Read-check-write with a
 * read-back confirm (localStorage has no atomics; the confirm shrinks
 * the double-winner window to near zero — and the loser path below
 * heals the remainder instead of logging out).
 */
export function tryAcquireRefreshLock(): boolean {
  const now = Date.now()
  const current = readLock()
  if (current && current.exp > now && current.owner !== TAB_ID) return false
  try {
    localStorage.setItem(lockKey(), JSON.stringify({ owner: TAB_ID, exp: now + LOCK_TTL_MS }))
  } catch {
    return false
  }
  return readLock()?.owner === TAB_ID
}

/** Release only our own lock (never a sibling's). */
export function releaseRefreshLock(): void {
  try {
    if (readLock()?.owner === TAB_ID) localStorage.removeItem(lockKey())
  } catch { /* ignore */ }
}

/** Monotonic counter bumped by every winner (no secrets — just a signal). */
export function readRefreshSeq(): number {
  const raw = readLS(seqKey())
  const n = raw === null ? 0 : Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Announce new tokens to sibling tabs (memory-only channel). */
export function announceRefresh(access: string, refresh: string | null): void {
  try {
    localStorage.setItem(seqKey(), String(readRefreshSeq() + 1))
  } catch { /* ignore */ }
  if (typeof BroadcastChannel === "undefined") return
  const profile = getActiveProfileId()
  const send = () => {
    try {
      new BroadcastChannel(BC_NAME).postMessage({
        type: "nurchat:refreshed",
        profile,
        access,
        refresh,
        at: Date.now(),
      })
    } catch { /* ignore */ }
  }
  send()
  // Repeat once: a tab that subscribed between our refresh and our first
  // post would otherwise miss memory-only tokens forever.
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = setTimeout(send, ANNOUNCE_REPEAT_MS)
}

/**
 * Wait for a sibling's tokens. Resolves null fast when there is no
 * evidence a sibling is (or just was) refreshing — logout stays instant.
 */
export function waitForSiblingTokens(timeoutMs = SIBLING_WAIT_MS): Promise<SiblingTokens | null> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(null)
  const profile = getActiveProfileId()
  return new Promise((resolve) => {
    let done = false
    let bc: BroadcastChannel | null = null
    const finish = (value: SiblingTokens | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        bc?.close()
      } catch { /* ignore */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      bc = new BroadcastChannel(BC_NAME)
      bc.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as Partial<SiblingTokens & { type: string; profile: string | null }>
        if (msg?.type === "nurchat:refreshed" && msg.profile === profile && typeof msg.access === "string") {
          finish({ access: msg.access, refresh: msg.refresh ?? null })
        }
      }
    } catch {
      finish(null)
    }
  })
}

export const REFRESH_SYNC_TIMINGS = {
  siblingWaitMs: SIBLING_WAIT_MS,
  siblingShortWaitMs: SIBLING_SHORT_WAIT_MS,
}

/**
 * Test seam: cancel a pending announce repeat so one test's winner
 * broadcast can't leak into the next test's subscriber. Production
 * never calls this (the repeat is intentional there).
 */
export function resetRefreshSyncForTests(): void {
  if (announceTimer) {
    clearTimeout(announceTimer)
    announceTimer = null
  }
}
