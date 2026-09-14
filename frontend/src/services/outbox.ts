/**
 * Outbox — оффлайн-очередь исходящих сообщений (IndexedDB `nurchat-outbox`).
 *
 * Пока relay лежит или сеть порвана, handleSend кладёт плейнтекст в outbox
 * (локальное устройство — шифровать нечего, конверт строится при отправке).
 * flushOutbox перешифровывает свежими ключами и шлёт через обычный REST-путь.
 * Отравленные записи (чат удалён / >10 неудач) удаляются, а не крутятся вечно.
 */

export interface OutboxEntry {
  id?: number
  chatId: string
  text: string
  replyToId?: string
  expiresAt?: string
  createdAt: string
  attempts: number
}

const DB_NAME = "nurchat-outbox"
const STORE = "messages"
const MAX_ATTEMPTS = 10

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) {
      reject(e)
    }
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        try {
          const t = db.transaction(STORE, mode)
          const req = fn(t.objectStore(STORE))
          req.onsuccess = () => {
            const v = req.result
            db.close()
            resolve(v)
          }
          req.onerror = () => {
            db.close()
            reject(req.error)
          }
        } catch (e) {
          try { db.close() } catch { /* ignore */ }
          reject(e)
        }
      }),
  )
}

export async function queueOutboxMessage(
  entry: Omit<OutboxEntry, "createdAt" | "attempts" | "id">,
): Promise<void> {
  await tx("readwrite", (s) =>
    s.add({
      ...entry,
      createdAt: new Date().toISOString(),
      attempts: 0,
    } as OutboxEntry),
  )
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  try {
    return await tx("readonly", (s) => s.getAll())
  } catch {
    return []
  }
}

export async function removeOutbox(id: number): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id))
  } catch { /* ignore */ }
}

export async function bumpOutboxAttempts(entry: OutboxEntry): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put({ ...entry, attempts: entry.attempts + 1 }))
  } catch { /* ignore */ }
}

export async function countOutbox(): Promise<number> {
  try {
    return await tx("readonly", (s) => s.count())
  } catch {
    return 0
  }
}

export function isPoison(entry: OutboxEntry): boolean {
  return entry.attempts >= MAX_ATTEMPTS
}
