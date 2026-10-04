/**
 * Профили аккаунтов (мультиаккаунт, активен один за раз).
 *
 * Аккаунт живёт на ОДНОМ реле, поэтому профиль = (релей + userId).
 * Переключение = смена активного профиля + релея + перезагрузка
 * (BASE_URL/WS_BASE заморожены на старте модуля, память чистится).
 *
 * Совместимость: у существующих пользователей данные лежат под
 * глобальными ключами. Первый (legacy-)профиль использует ПУСТОЙ
 * неймспейс — миграция записей не нужна; префикс получают только
 * профили, созданные вторыми и далее.
 */

export interface AccountProfile {
  /** `${protocol}://${host}::${userId}`; у legacy-профиля — "legacy". */
  id: string
  relayHost: string
  relayProtocol: "http" | "https"
  userId: string
  username: string
  createdAt: number
  lastUsedAt: number
}

export const LEGACY_PROFILE_ID = "legacy"

const PROFILES_KEY = "nurchat_profiles_v1"
const ACTIVE_KEY = "nurchat_active_profile_v1"

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function isProfile(v: unknown): v is AccountProfile {
  if (typeof v !== "object" || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === "string" &&
    typeof p.relayHost === "string" &&
    (p.relayProtocol === "http" || p.relayProtocol === "https") &&
    typeof p.userId === "string" &&
    typeof p.username === "string"
  )
}

export function profileId(relayProtocol: string, relayHost: string, userId: string): string {
  return `${relayProtocol}://${relayHost}::${userId}`
}

export function listProfiles(): AccountProfile[] {
  const raw = readJSON<unknown[]>(PROFILES_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter(isProfile)
}

function saveProfiles(profiles: AccountProfile[]): void {
  writeJSON(PROFILES_KEY, profiles)
}

export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function getActiveProfile(): AccountProfile | null {
  const id = getActiveProfileId()
  if (!id) return null
  return listProfiles().find((p) => p.id === id) ?? null
}

export function setActiveProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* ignore */
  }
  if (id) touchProfile(id)
}

function touchProfile(id: string): void {
  const profiles = listProfiles()
  const p = profiles.find((x) => x.id === id)
  if (p) {
    p.lastUsedAt = Date.now()
    saveProfiles(profiles)
  }
}

/**
 * Создать или обновить профиль после успешного входа/регистрации.
 * Первый профиль на устройстве — legacy (пустой неймспейс хранилищ).
 */
export function upsertProfile(relayProtocol: string, relayHost: string, userId: string, username: string): AccountProfile {
  const profiles = listProfiles()
  const now = Date.now()
  const existingIdx = profiles.findIndex(
    (p) => p.relayHost === relayHost && p.relayProtocol === relayProtocol && p.userId === userId,
  )
  if (existingIdx >= 0) {
    const existing = profiles[existingIdx]
    existing.username = username
    existing.lastUsedAt = now
    saveProfiles(profiles)
    setActiveProfileId(existing.id)
    return existing
  }
  const fresh: AccountProfile = {
    id: profiles.length === 0 ? LEGACY_PROFILE_ID : profileId(relayProtocol, relayHost, userId),
    relayHost,
    relayProtocol: relayProtocol === "https" ? "https" : "http",
    userId,
    username,
    createdAt: now,
    lastUsedAt: now,
  }
  profiles.push(fresh)
  saveProfiles(profiles)
  setActiveProfileId(fresh.id)
  return fresh
}

/** Удалить профиль (записи хранилищ стираются отдельно по неймспейсу). */
export function removeProfile(id: string): void {
  saveProfiles(listProfiles().filter((p) => p.id !== id))
  if (getActiveProfileId() === id) setActiveProfileId(null)
}

/**
 * Гарантировать профиль для текущей сессии (legacy для первого).
 * Нужно экспорту/списку, когда вход был до появления профилей.
 */
export function ensureActiveProfile(
  relayProtocol: string,
  relayHost: string,
  userId: string,
  username: string,
): AccountProfile {
  const active = getActiveProfile()
  if (active) return active
  return upsertProfile(relayProtocol, relayHost, userId, username)
}

/**
 * Неймспейс записей активного профиля для ключей/сессий/файлов-настроек.
 * "" = legacy (глобальные ключи, как раньше).
 */
export function activeNamespace(): string {
  const active = getActiveProfile()
  if (!active || active.id === LEGACY_PROFILE_ID) return ""
  return `${active.id}::`
}

/** Неймспейс конкретного профиля (для wipe при удалении). */
export function namespaceOf(profile: AccountProfile): string {
  return profile.id === LEGACY_PROFILE_ID ? "" : `${profile.id}::`
}

/** localStorage-ключ с учётом активного профиля. */
export function namespacedLSKey(base: string): string {
  const ns = activeNamespace()
  return ns ? `${ns}${base}` : base
}
