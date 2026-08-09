import i18n from "../i18n"

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "long", year: "numeric", timeZone: TZ })
}

export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(i18n.language, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const d = new Date(iso).getTime()
  const diff = now - d

  if (diff < 0) return formatTime(iso)

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return i18n.t("format.justNow")

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return i18n.t("format.minutesAgo", { count: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return i18n.t("format.hoursAgo", { count: hours })

  const days = Math.floor(hours / 24)
  if (days < 7) return i18n.t("format.daysAgo", { count: days })

  const date = new Date(iso)
  const nowDate = new Date()
  if (date.getFullYear() === nowDate.getFullYear()) {
    return date.toLocaleDateString(i18n.language, { day: "numeric", month: "short", timeZone: TZ })
  }
  return date.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric", timeZone: TZ })
}
