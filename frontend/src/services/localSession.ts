/**
 * Жизненный цикл локальной сессии: выход и смена аккаунта на одном устройстве.
 *
 * E2E-ключи (IndexedDB `nurchat-secure`) хранятся один набор на устройство,
 * поэтому перед входом под другим пользователем их нужно сбросить — иначе
 * новый аккаунт подхватит identity-ключи предыдущего.
 */

import { api } from "./api"
import { setRelayConfig, type RelayConfig } from "../config"
import { readStoredUserRaw } from "./tokenVault"
import { namespacedLSKey } from "./profiles"
import { lockCrypto } from "./pinLock"
import { clearKeys, resetMemoryCaches } from "./e2e"
import { clearPlaintextCache } from "./plaintextCache"
import { useFavoritesStore } from "../store/favoritesStore"
import { useChatStore } from "../store/chatStore"

const KEYS_OWNER_BASE = "e2e_keys_owner"

/** Владелец ключей активного профиля (у каждого аккаунта свои ключи). */
function ownerKey(): string {
  return namespacedLSKey(KEYS_OWNER_BASE)
}

/** Обычный выход: токены и память. PIN остаётся (device-уровень): ключи
 * лежат PIN-зашифрованными, следующий вход — через PinLock. Из памяти
 * падает только passphrase (lockCrypto), хранилище НЕ перешифровывается. */
export function performLogout(): void {
  api.clearToken()
  lockCrypto()
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
  try { owner = localStorage.getItem(ownerKey()) } catch { /* ignore */ }

  let wiped = false
  if (owner && owner !== userId) {
    await clearKeys()
    clearPlaintextCache()
    useFavoritesStore.getState().clear()
    wiped = true
  }
  try { localStorage.setItem(ownerKey(), userId) } catch { /* ignore */ }
  return wiped
}

/** После удаления аккаунта: владельца тоже забываем. */
export function releaseLocalKeys(): void {
  try { localStorage.removeItem(ownerKey()) } catch { /* ignore */ }
  clearPlaintextCache()
  useFavoritesStore.getState().clear()
}

/** Аккаунт, привязанный к устройству (если был вход), — для guard'а смены релея. */
export function storedAccount(): { username: string } | null {
  try {
    const raw = readStoredUserRaw()
    if (!raw) return null
    const parsed = JSON.parse(raw) as { username?: unknown }
    return typeof parsed.username === "string" ? { username: parsed.username } : null
  } catch {
    return null
  }
}

/**
 * Смена релея: аккаунт живёт на ОДНОМ реле (история и ключи на новом
 * будут пустыми), поэтому молча переключаться нельзя. Выход + забыть
 * локальный профиль + релей + перезагрузка (BASE_URL заморожен на старте).
 */
export function performRelaySwitch(config: RelayConfig): void {
  performLogout()
  setRelayConfig(config)
  window.location.reload()
}
