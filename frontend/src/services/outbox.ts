/**
 * Outbox — оффлайн-очередь исходящих сообщений.
 *
 * Пока relay лежит или сеть порвана, handleSend кладёт текст в outbox
 * (локальное устройство — конверт строится при отправке).
 * flushOutbox перешифровывает свежими ключами и шлёт через обычный REST-путь.
 * Отравленные записи (чат удалён / >10 неудач) удаляются, а не крутятся вечно.
 *
 * At-rest: записи хранятся ШИФРОВАННЫМИ (AES-256-GCM через wrapping-ключ
 * secureStorage, STORE_META `outbox-queue`). Раньше очередь лежала
 * плейнтекстом в отдельной IndexedDB `nurchat-outbox` — дамп диска читал
 * неотправленные черновики. Та же честная оговорка, что у secureStorage:
 * device_secret в браузере без OS-keystore лежит в IndexedDB открытым
 * текстом, так что это поднятие планки, а не неуязвимость.
 * Миграция: при первом чтении legacy-плейнтекст импортируется и удаляется.
 */

import { storeSecureValue, loadSecureValue } from "./secureStorage"

export interface OutboxEntry {
  id?: number
  chatId: string
  text: string
  replyToId?: string
  expiresAt?: string
  createdAt: string
  attempts: number
}

const SECURE_KEY = "outbox-queue"
const MAX_ATTEMPTS = 10

// Legacy plaintext store (pre-encryption). Import once, then drop.
const LEGACY_DB = "nurchat-outbox"
const LEGACY_STORE = "messages"

let legacyMigrated = false

function readLegacyDb(): Promise<OutboxEntry[]> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LEGACY_DB, 1)
      req.onupgradeneeded = () => {
        // БД нет — создавать нечего, сразу закрываем апгрейд.
        try { req.transaction?.abort() } catch { /* ignore */ }
      }
      req.onsuccess = () => {
        try {
          const db = req.result
          if (!db.objectStoreNames.contains(LEGACY_STORE)) {
            db.close()
            resolve([])
            return
          }
          const t = db.transaction(LEGACY_STORE, "readonly")
          const getAll = t.objectStore(LEGACY_STORE).getAll()
          getAll.onsuccess = () => {
            const rows = (getAll.result || []) as OutboxEntry[]
            db.close()
            resolve(rows)
          }
          getAll.onerror = () => {
            try { db.close() } catch { /* ignore */ }
            resolve([])
          }
        } catch {
          resolve([])
        }
      }
      req.onerror = () => resolve([])
      req.onblocked = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

function dropLegacyDb(): void {
  try {
    const req = indexedDB.deleteDatabase(LEGACY_DB)
    req.onblocked = () => { /* ignore — удалится при следующем старте */ }
  } catch { /* ignore */ }
}

async function loadAll(): Promise<OutboxEntry[]> {
  const stored = await loadSecureValue<OutboxEntry[]>(SECURE_KEY)
  if (stored) {
    legacyMigrated = true
    return Array.isArray(stored) ? stored : []
  }
  if (!legacyMigrated) {
    legacyMigrated = true
    const legacy = await readLegacyDb()
    if (legacy.length > 0) {
      const normalized = legacy.map((e, i) => ({
        chatId: e.chatId,
        text: e.text,
        replyToId: e.replyToId,
        expiresAt: e.expiresAt,
        createdAt: e.createdAt || new Date().toISOString(),
        attempts: typeof e.attempts === "number" ? e.attempts : 0,
        id: typeof e.id === "number" ? e.id : i + 1,
      }))
      await storeSecureValue(SECURE_KEY, normalized)
      dropLegacyDb()
      return normalized
    }
  }
  return []
}

async function saveAll(entries: OutboxEntry[]): Promise<void> {
  await storeSecureValue(SECURE_KEY, entries)
}

export async function queueOutboxMessage(
  entry: Omit<OutboxEntry, "createdAt" | "attempts" | "id">,
): Promise<void> {
  const all = await loadAll()
  const nextId = all.reduce((m, e) => Math.max(m, e.id ?? 0), 0) + 1
  all.push({
    ...entry,
    createdAt: new Date().toISOString(),
    attempts: 0,
    id: nextId,
  } as OutboxEntry)
  await saveAll(all)
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  try {
    return await loadAll()
  } catch {
    return []
  }
}

export async function removeOutbox(id: number): Promise<void> {
  try {
    const all = await loadAll()
    await saveAll(all.filter((e) => e.id !== id))
  } catch { /* ignore */ }
}

export async function bumpOutboxAttempts(entry: OutboxEntry): Promise<void> {
  try {
    const all = await loadAll()
    await saveAll(all.map((e) => (e.id === entry.id ? { ...e, attempts: e.attempts + 1 } : e)))
  } catch { /* ignore */ }
}

export async function countOutbox(): Promise<number> {
  try {
    return (await loadAll()).length
  } catch {
    return 0
  }
}

export function isPoison(entry: OutboxEntry): boolean {
  return entry.attempts >= MAX_ATTEMPTS
}
