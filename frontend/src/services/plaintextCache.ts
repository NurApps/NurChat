/**
 * Локальный кэш открытого текста СВОИХ отправленных сообщений.
 *
 * Зачем: в Double Ratchet отправитель не может расшифровать собственные
 * сообщения из истории (sending-цепочка ≠ receiving-цепочка, ключи
 * удаляются после использования — forward secrecy). То же в групповом
 * ратчете: свой шаг уже ушёл вперёд. Поэтому историю своих сообщений
 * расшифровать нельзя в принципе — показываем сохранённую при отправке
 * копию. Чужие сообщения кэшировать НЕЛЬЗЯ (их текст нам недоступен
 * в открытом виде, кроме момента расшифровки — и это тоже не храним).
 *
 * Хранение: localStorage, только своё устройство, bounded (2000 записей,
 * старые вытесняются). Это не ослабляет E2E: текст и так был набран
 * на этом устройстве.
 */

const STORAGE_KEY = "nurchat_plaintext_v1"
const MAX_ENTRIES = 2000

export type PlaintextCache = Record<string, string>

export function loadPlaintextCache(): PlaintextCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as PlaintextCache
    return {}
  } catch {
    return {}
  }
}

function persist(cache: PlaintextCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded: выбрасываем старую половину и пробуем ещё раз
    const keys = Object.keys(cache)
    for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete cache[k]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch { /* ignore — кэш best-effort */ }
  }
}

export function savePlaintext(messageId: string, text: string): void {
  if (!messageId || !text) return
  const cache = loadPlaintextCache()
  if (cache[messageId] === text) return
  cache[messageId] = text
  const keys = Object.keys(cache)
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k]
  }
  persist(cache)
}

export function getPlaintext(messageId: string): string | null {
  if (!messageId) return null
  return loadPlaintextCache()[messageId] ?? null
}
