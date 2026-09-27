/**
 * Избранное: локальный самочат (как Saved Messages в Telegram) — можно
 * писать себе заметки и пересылать туда любые сообщения. Хранится только
 * на этом устройстве (localStorage), без сети и шифрования: это не полноценный
 * чат в понимании relay (нет chat_id/участников), поэтому движок 1:1-чата
 * (Double Ratchet, WS) тут не участвует. Очищается при смене владельца
 * устройства, см. services/localSession.ts.
 */
import { create } from "zustand"
import type { MessageResponse } from "../types"

export interface FavoriteEntry {
  id: string
  content: string
  createdAt: string
  /** Пересланное сообщение хранит имя исходного автора; заметка — нет. */
  forwardedFromName?: string
  forwardedMessageType?: string
  forwardedFileName?: string
}

const STORAGE_KEY = "nurchat_favorites_v1"
const MAX_ENTRIES = 2000

function load(): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FavoriteEntry[]) : []
  } catch {
    return []
  }
}

function persist(items: FavoriteEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* ignore — quota или приватный режим, храним best-effort */
  }
}

function makeId(): string {
  return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

interface FavoritesState {
  items: FavoriteEntry[]
  addNote: (content: string) => void
  addForwarded: (message: MessageResponse) => void
  remove: (id: string) => void
  clear: () => void
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  items: load(),

  addNote: (content) => {
    const text = content.trim()
    if (!text) return
    const entry: FavoriteEntry = { id: makeId(), content: text, createdAt: new Date().toISOString() }
    const items = [...get().items, entry].slice(-MAX_ENTRIES)
    persist(items)
    set({ items })
  },

  addForwarded: (message) => {
    const entry: FavoriteEntry = {
      id: makeId(),
      content: message.content,
      createdAt: new Date().toISOString(),
      forwardedFromName: message.user?.username || "",
      forwardedMessageType: message.message_type,
      forwardedFileName: message.file?.filename,
    }
    const items = [...get().items, entry].slice(-MAX_ENTRIES)
    persist(items)
    set({ items })
  },

  remove: (id) => {
    const items = get().items.filter((i) => i.id !== id)
    persist(items)
    set({ items })
  },

  clear: () => {
    persist([])
    set({ items: [] })
  },
}))
