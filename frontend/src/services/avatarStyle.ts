import { useSyncExternalStore } from "react"

// Стиль дефолтных аватарок (когда у юзера нет загруженного фото):
// "identicon" — геометрическая иконка в духе GitHub, "letter" — буква.
// Хранится в localStorage, применяется мгновенно везде через хук.

export type AvatarStyle = "identicon" | "letter"

const KEY = "nurchat_avatar_style"
const DEFAULT: AvatarStyle = "identicon"

const listeners = new Set<() => void>()
function notify() {
  listeners.forEach((l) => l())
}

function read(): AvatarStyle {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === "identicon" || raw === "letter") return raw
  } catch {
    /* ignore storage errors */
  }
  return DEFAULT
}

export function getAvatarStyle(): AvatarStyle {
  return read()
}

export function setAvatarStyle(style: AvatarStyle): void {
  try {
    localStorage.setItem(KEY, style)
  } catch {
    /* ignore storage errors */
  }
  notify()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useAvatarStyle(): AvatarStyle {
  return useSyncExternalStore(subscribe, read, read)
}
