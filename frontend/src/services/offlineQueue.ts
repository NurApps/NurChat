const DB_NAME = "nurchat-offline"
const DB_VERSION = 1
const STORE_NAME = "pending_messages"

interface PendingMessage {
  id: string
  chatId: string
  content: string
  messageType: string
  createdAt: number
  retries: number
  lastError?: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("chatId", "chatId", { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
    }
  })
}

export async function enqueueMessage(msg: Omit<PendingMessage, "id" | "createdAt" | "retries">): Promise<string> {
  const db = await openDB()
  const id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const entry: PendingMessage = {
    ...msg,
    id,
    createdAt: Date.now(),
    retries: 0,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve(id)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPendingMessages(chatId?: string): Promise<PendingMessage[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const index = chatId ? store.index("chatId") : store
    const request = index.getAll(chatId ? IDBKeyRange.only(chatId) : undefined)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function removeMessage(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function updateMessageRetries(id: string, lastError: string): Promise<void> {
  const db = await openDB()
  const msg = await new Promise<PendingMessage | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (!msg) return
  msg.retries += 1
  msg.lastError = lastError
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(msg)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearPendingMessages(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const MAX_RETRIES = 5
const BASE_DELAY = 1000

export function getRetryDelay(retries: number): number {
  return Math.min(BASE_DELAY * Math.pow(2, retries), 30000)
}

export function shouldRetry(retries: number): boolean {
  return retries < MAX_RETRIES
}
