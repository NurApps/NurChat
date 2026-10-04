/**
 * Трансфер-бандл: ПЕРЕЕЗД аккаунта на другое устройство (move, не клон).
 *
 * Содержит identity-ключи, prekeys, DR-сессии и групповые ратчеты —
 * всё, что нужно, чтобы второе устройство продолжило с того же места.
 * Шифруется паролем (PBKDF2 100k + AES-256-GCM), формат:
 *   { format, version, salt, iv, data } — base64.
 *
 * Почему move, а не clone: Double Ratchet не терпит две живые копии
 * состояния — цепочки разойдутся и расшифровка сломается. После импорта
 * старое устройство обязано затереть ключи (экспорт предлагает это
 * чекбоксом, импорт предупреждает).
 */

import {
  loadIdentityKeys,
  loadSPK,
  loadOPKs,
  loadSessions,
  loadSecureValue,
  storeIdentityKeys,
  storeSPK,
  storeOPKs,
  storeSessions,
  storeSecureValue,
  setRecordNamespace,
  type StoredKeyPair,
  type StoredSPK,
  type StoredOPK,
} from "./secureStorage"
import { upsertProfile, namespaceOf, setActiveProfileId } from "./profiles"
import { setRelayConfig } from "../config"
import { performLogout } from "./localSession"

export const TRANSFER_FORMAT = "nurchat-transfer"
export const TRANSFER_VERSION = 1

const PBKDF2_ITERATIONS = 100_000
// Ключи meta-хранилища, входящие в бандл (device_secret — НЕТ, он устройства).
const GROUP_RATCHET_KEY = "group_ratchet_states"
const OUTBOX_KEY = "outbox-queue"

export interface TransferPayload {
  format: typeof TRANSFER_FORMAT
  version: number
  exportedAt: number
  relayHost: string
  relayProtocol: "http" | "https"
  username: string
  userId: string
  identity: StoredKeyPair
  spk: StoredSPK | null
  opks: StoredOPK[]
  sessions: Record<string, unknown> | null
  groupStates: unknown
  outbox: unknown
}

export interface TransferEnvelope {
  format: typeof TRANSFER_FORMAT
  version: number
  salt: string
  iv: string
  data: string
}

function b64encode(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

/** Зашифровать payload паролем (ядро экспорта, без хранилищ — тестируемо). */
export async function encryptTransferPayload(
  payload: TransferPayload,
  password: string,
): Promise<TransferEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    salt: b64encode(salt),
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(ciphertext)),
  }
}

/** Собрать бандл из хранилищ АКТИВНОГО профиля. */
export async function exportTransferBundle(
  relayHost: string,
  relayProtocol: "http" | "https",
  username: string,
  userId: string,
  password: string,
): Promise<TransferEnvelope> {
  const identity = await loadIdentityKeys()
  if (!identity) throw new Error("no-identity")
  const payload: TransferPayload = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: Date.now(),
    relayHost,
    relayProtocol,
    username,
    userId,
    identity,
    spk: await loadSPK(),
    opks: await loadOPKs(),
    sessions: await loadSessions(),
    groupStates: await loadSecureValue(GROUP_RATCHET_KEY),
    outbox: await loadSecureValue(OUTBOX_KEY),
  }
  return encryptTransferPayload(payload, password)
}

function isPayload(v: unknown): v is TransferPayload {
  if (typeof v !== "object" || v === null) return false
  const p = v as Record<string, unknown>
  return (
    p.format === TRANSFER_FORMAT &&
    p.version === TRANSFER_VERSION &&
    typeof p.relayHost === "string" &&
    (p.relayProtocol === "http" || p.relayProtocol === "https") &&
    typeof p.username === "string" &&
    typeof p.userId === "string" &&
    typeof p.identity === "object" &&
    p.identity !== null
  )
}

/** Расшифровать и проверить бандл (без записи). Ошибка пароля = "bad-password". */
export async function decryptTransferBundle(envelope: unknown, password: string): Promise<TransferPayload> {
  if (typeof envelope !== "object" || envelope === null) throw new Error("bad-format")
  const env = envelope as Partial<TransferEnvelope>
  if (env.format !== TRANSFER_FORMAT || env.version !== TRANSFER_VERSION || !env.salt || !env.iv || !env.data) {
    throw new Error("bad-format")
  }
  const key = await deriveKey(password, b64decode(env.salt))
  let plaintext: string
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(env.iv) },
      key,
      b64decode(env.data),
    )
    plaintext = new TextDecoder().decode(decrypted)
  } catch {
    throw new Error("bad-password")
  }
  let payload: unknown
  try {
    payload = JSON.parse(plaintext)
  } catch {
    throw new Error("bad-format")
  }
  if (!isPayload(payload)) throw new Error("bad-format")
  return payload
}

/**
 * Импорт бандла: создаёт профиль, кладёт ключи в его неймспейс,
 * переключает релей и перезагружается. Старое устройство после этого
 * обязано затереть ключи (иначе форк Double Ratchet).
 */
export async function importTransferBundle(payload: TransferPayload): Promise<void> {
  // Сначала гасим текущую сессию (токен старого профиля отзывается на сервере).
  performLogout()
  const profile = upsertProfile(payload.relayProtocol, payload.relayHost, payload.userId, payload.username)
  // Пишем в неймспейс НОВОГО профиля (текущая сессия ещё на старом).
  setRecordNamespace(namespaceOf(profile))
  await storeIdentityKeys(payload.identity)
  if (payload.spk) await storeSPK(payload.spk)
  if (payload.opks?.length) await storeOPKs(payload.opks)
  if (payload.sessions) await storeSessions(payload.sessions)
  if (payload.groupStates !== null && payload.groupStates !== undefined) {
    await storeSecureValue(GROUP_RATCHET_KEY, payload.groupStates)
  }
  if (payload.outbox !== null && payload.outbox !== undefined) {
    await storeSecureValue(OUTBOX_KEY, payload.outbox)
  }
  setActiveProfileId(profile.id)
  setRelayConfig({ host: payload.relayHost, protocol: payload.relayProtocol })
  // Токенов нового профиля ещё нет — вход по паролю/2FA после перезагрузки.
  window.location.reload()
}

/** Полный снос профиля с устройства: сессия, ключи, кэши, избранное. */
export async function wipeProfileData(profileId: string): Promise<void> {
  const { listProfiles, removeProfile, getActiveProfileId, namespaceOf: nsOf } = await import("./profiles")
  const { clearNamespace } = await import("./secureStorage")
  const profile = listProfiles().find((p) => p.id === profileId)
  if (!profile) return
  const wasActive = getActiveProfileId() === profileId
  const ns = nsOf(profile)
  // localStorage-ключи профиля
  const suffixes = ["refresh_token", "user", "e2e_keys_owner", "nurchat_favorites_v1", "nurchat_plaintext_v1"]
  for (const s of suffixes) {
    try {
      localStorage.removeItem(ns ? `${ns}${s}` : s)
    } catch {
      /* ignore */
    }
  }
  await clearNamespace(ns)
  removeProfile(profileId)
  if (wasActive) {
    performLogout()
    window.location.reload()
  }
}
