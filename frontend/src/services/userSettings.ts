const SETTINGS_KEY = "nurchat_settings"

export interface UserSettings {
  messageSound: boolean
  callSound: boolean
  messagePreview: boolean
  desktopNotifications: boolean
}

const DEFAULTS: UserSettings = {
  messageSound: true,
  callSound: true,
  messagePreview: true,
  desktopNotifications: true,
}

let cache: UserSettings | null = null

export function getSettings(): UserSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    // Только известные ключи: старые showOnline/showLastSeen были пустышками.
    cache = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof UserSettings)[]) {
      if (typeof parsed[k] === "boolean") cache[k] = parsed[k]
    }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

export function setSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): UserSettings {
  const next = { ...getSettings(), [key]: value }
  cache = next
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* ignore storage errors */
  }
  return next
}

export function clearSettings(): void {
  cache = null
  try {
    localStorage.removeItem(SETTINGS_KEY)
  } catch {
    /* ignore */
  }
}