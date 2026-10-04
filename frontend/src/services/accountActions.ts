import { getRelayConfig, setRelayConfig } from "../config"
import {
  ensureActiveProfile,
  getActiveProfileId,
  listProfiles,
  setActiveProfileId,
  type AccountProfile,
} from "./profiles"
import { readStoredUserRaw } from "./tokenVault"
import { performLogout } from "./localSession"

function storedUser(): { id: string; username: string } | null {
  try {
    const raw = readStoredUserRaw()
    if (!raw) return null
    const p = JSON.parse(raw) as { id?: unknown; username?: unknown }
    return typeof p.id === "string" && typeof p.username === "string" ? { id: p.id, username: p.username } : null
  } catch {
    return null
  }
}

/**
 * Список профилей для переключателя. Если вход был до появления профилей,
 * текущая сессия попадает в список (иначе «Добавить аккаунт» потеряло бы её).
 */
export function loadAccounts(): { profiles: AccountProfile[]; activeId: string | null } {
  if (!getActiveProfileId()) {
    const u = storedUser()
    if (u) {
      const relay = getRelayConfig()
      ensureActiveProfile(relay.protocol, relay.host, u.id, u.username)
    }
  }
  return { profiles: listProfiles(), activeId: getActiveProfileId() }
}

/** Без потерь: все профили уже сохранены. Память умирает перезагрузкой. */
export function switchToProfile(target: AccountProfile): void {
  setActiveProfileId(target.id)
  setRelayConfig({ host: target.relayHost, protocol: target.relayProtocol })
  window.location.reload()
}

/** Новый вход = новая сессия: текущую гасим, профиль остаётся в списке. */
export function startAddAccount(): void {
  performLogout()
}
