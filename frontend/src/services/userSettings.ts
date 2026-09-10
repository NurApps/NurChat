const SETTINGS_KEY = "nurchat_settings"

export interface UserSettings {
  messageSound: boolean
  callSound: boolean
  messagePreview: boolean
  desktopNotifications: boolean
  showOnline: boolean
  showLastSeen: boolean
}

const DEFAULTS: UserSettings = {
  messageSound: true,
  callSound: true,
  messagePreview: true,
  desktopNotifications: true,
  showOnline: true,
  showLastSeen: true,
}

let cache: UserSettings | null = null

export function getSettings(): UserSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    cache = { ...DEFAULTS, ...parsed }
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