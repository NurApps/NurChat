/**
 * Outbox at-rest encryption: очередь шифруется wrapping-ключом
 * secureStorage, плейнтекст на диске не лежит. Legacy-плейнтекст
 * `nurchat-outbox` мигрирует один раз и удаляется.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { openDB } from "idb"

async function freshOutbox() {
  vi.resetModules()
  return await import("../services/outbox")
}

async function readRawSecureMeta(key: string): Promise<unknown> {
  const db = await openDB("nurchat-secure", 2)
  const v = await db.get("meta", key)
  db.close()
  return v
}

async function clearQueue(ob: typeof import("../services/outbox")): Promise<void> {
  // deleteDatabase виснет при живых коннектах fake-indexeddb (да и в
  // реальном браузере блокируется открытыми табами) — чистим через API.
  const items = await ob.listOutbox()
  for (const item of items) {
    if (item.id !== undefined) await ob.removeOutbox(item.id)
  }
}

const hasSubtle = typeof crypto !== "undefined" && !!crypto.subtle

describe.skipIf(!hasSubtle)("outbox at-rest encryption", () => {
  beforeEach(async () => {
    vi.resetModules()
    await clearQueue(await import("../services/outbox"))
  })

  it("queue → list roundtrip, ids autoincrement", async () => {
    const ob = await freshOutbox()
    await ob.queueOutboxMessage({ chatId: "c1", text: "привет" })
    await ob.queueOutboxMessage({ chatId: "c1", text: "мир", replyToId: "m1" })
    const items = await ob.listOutbox()
    expect(items).toHaveLength(2)
    expect(items[0].text).toBe("привет")
    expect(items[1].replyToId).toBe("m1")
    expect(items[0].id).toBeLessThan(items[1].id as number)
    expect(await ob.countOutbox()).toBe(2)
  })

  it("ciphertext at rest: raw meta has no plaintext", async () => {
    const ob = await freshOutbox()
    const secret = "секретный-черновик-42"
    await ob.queueOutboxMessage({ chatId: "c1", text: secret })
    const raw = await readRawSecureMeta("outbox-queue")
    expect(typeof raw).toBe("string")
    // Кириллический секрет в base64-шифртексте встретиться не может.
    // (Короткие ASCII-куски вроде "c1" случайно могут — их не проверяем.)
    expect(raw as string).not.toContain(secret)
  })

  it("bump → poison → remove", async () => {
    const ob = await freshOutbox()
    await ob.queueOutboxMessage({ chatId: "c1", text: "яд" })
    let [item] = await ob.listOutbox()
    expect(ob.isPoison(item)).toBe(false)
    for (let i = 0; i < 10; i++) {
      await ob.bumpOutboxAttempts(item)
      ;[item] = await ob.listOutbox()
    }
    expect(item.attempts).toBe(10)
    expect(ob.isPoison(item)).toBe(true)
    await ob.removeOutbox(item.id as number)
    expect(await ob.countOutbox()).toBe(0)
  })

  it("legacy plaintext migrates once and legacy db is dropped", async () => {
    // Изоляция: secure-ключ от прошлых тестов (пустой массив = пост-
    // миграционное состояние) сносим — иначе миграция не запустится.
    {
      const db = await openDB("nurchat-secure", 2)
      await db.delete("meta", "outbox-queue")
      db.close()
    }
    // Кладём legacy-плейнтекст напрямую в старую БД.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("nurchat-outbox", 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore("messages", { keyPath: "id", autoIncrement: true })
      }
      req.onsuccess = () => {
        const db = req.result
        const t = db.transaction("messages", "readwrite")
        t.objectStore("messages").add({
          chatId: "c9", text: "legacy-черновик", createdAt: new Date().toISOString(), attempts: 3,
        })
        t.oncomplete = () => { db.close(); resolve() }
        t.onerror = () => reject(t.error)
      }
      req.onerror = () => reject(req.error)
    })
    const ob = await freshOutbox()
    const items = await ob.listOutbox()
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe("legacy-черновик")
    expect(items[0].attempts).toBe(3)
    // Шифрованная копия на месте, legacy-бд удалена.
    const raw = await readRawSecureMeta("outbox-queue")
    expect(typeof raw).toBe("string")
    const names = await indexedDB.databases?.().catch(() => [])
    if (names) {
      expect(names.map((d) => d.name)).not.toContain("nurchat-outbox")
    }
  })
})
