const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: TZ })
}

export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const d = new Date(iso).getTime()
  const diff = now - d

  if (diff < 0) return formatTime(iso)

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "только что"

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`

  const date = new Date(iso)
  const nowDate = new Date()
  if (date.getFullYear() === nowDate.getFullYear()) {
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: TZ })
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })
}
