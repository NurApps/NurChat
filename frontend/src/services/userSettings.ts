const SETTINGS_KEY = "nurchat_settings"

export const MESSAGE_SOUND_IDS = ["notify", "pop", "chime"] as const
export const RINGTONE_IDS = ["wave", "nokia"] as const
export type MessageSoundId = (typeof MESSAGE_SOUND_IDS)[number]
export type RingtoneId = (typeof RINGTONE_IDS)[number]

export interface UserSettings {
  messageSound: boolean
  callSound: boolean
  messagePreview: boolean
  desktopNotifications: boolean
  messageSoundId: MessageSoundId
  ringtoneId: RingtoneId
}

export type BooleanSettingKey = {
  [K in keyof UserSettings]: UserSettings[K] extends boolean ? K : never
}[keyof UserSettings]

const DEFAULTS: UserSettings = {
  messageSound: true,
  callSound: true,
  messagePreview: true,
  desktopNotifications: true,
  messageSoundId: "notify",
  ringtoneId: "wave",
}

let cache: UserSettings | null = null

export function getSettings(): UserSettings {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    // Только известные ключи: старые showOnline/showLastSeen были пустышками.
    cache = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as BooleanSettingKey[]) {
      if (typeof parsed[k] === "boolean") cache[k] = parsed[k]
    }
    // Неизвестный id (например, из будущей версии) — остаёмся на стандартном.
    if ((MESSAGE_SOUND_IDS as readonly unknown[]).includes(parsed.messageSoundId)) cache.messageSoundId = parsed.messageSoundId
    if ((RINGTONE_IDS as readonly unknown[]).includes(parsed.ringtoneId)) cache.ringtoneId = parsed.ringtoneId
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