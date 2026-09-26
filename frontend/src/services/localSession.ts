/**
 * Жизненный цикл локальной сессии: выход и смена аккаунта на одном устройстве.
 *
 * E2E-ключи (IndexedDB `nurchat-secure`) хранятся один набор на устройство,
 * поэтому перед входом под другим пользователем их нужно сбросить — иначе
 * новый аккаунт подхватит identity-ключи предыдущего.
 */

import { api } from "./api"
import { clearPin } from "./pinLock"
import { clearKeys, resetMemoryCaches } from "./e2e"
import { clearPlaintextCache } from "./plaintextCache"
import { useChatStore } from "../store/chatStore"

const KEYS_OWNER_KEY = "e2e_keys_owner"

/** Обычный выход: токены, PIN, память. Ключи и ratchet-сессии на диске остаются. */
export function performLogout(): void {
  api.clearToken()
  clearPin()
  resetMemoryCaches()
  useChatStore.getState().reset()
}

/**
 * Вызывать после успешного логина, до loadKeys(). Если ключи на устройстве
 * принадлежат другому пользователю — стираем ключи, сессии, outbox и кэш
 * открытого текста. Возвращает true, если данные были стёрты.
 */
export async function claimLocalKeys(userId: string): Promise<boolean> {
  let owner: string | null = null
  try { owner = localStorage.getItem(KEYS_OWNER_KEY) } catch { /* ignore */ }

  let wiped = false
  if (owner && owner !== userId) {
    await clearKeys()
    clearPlaintextCache()
    wiped = true
  }
  try { localStorage.setItem(KEYS_OWNER_KEY, userId) } catch { /* ignore */ }
  return wiped
}

/** После удаления аккаунта: владельца тоже забываем. */
export function releaseLocalKeys(): void {
  try { localStorage.removeItem(KEYS_OWNER_KEY) } catch { /* ignore */ }
  clearPlaintextCache()
}
