import { platform } from "./platform"

/** Локальный relay, который поднимает десктоп-приложение. */
export const LOCAL_RELAY = "http://127.0.0.1:8000"

export type HostState = "stopped" | "downloading" | "starting" | "restarting" | "ready" | "error"

export interface HostStatus {
  state: HostState
  url?: string | null
  error?: string | null
}

export interface HostPolicy {
  invite_only: boolean
  invite_code: string | null
}

export function hostModeSupported(): boolean {
  return platform.isTauri
}

async function localCsrfToken(): Promise<string> {
  const res = await fetch(`${LOCAL_RELAY}/health`, { cache: "no-store" })
  if (!res.ok) throw new Error(`local relay: HTTP ${res.status}`)
  return res.headers.get("X-CSRF-Token") || ""
}

async function localJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${LOCAL_RELAY}${path}`, { cache: "no-store", ...init })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body.detail === "string") detail = body.detail
    } catch { /* not json */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export async function localRelayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_RELAY}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return false
    // Порт 8000 может занимать чужой сервис: туннелировать его как NurChat
    // нельзя. Проверяем идентичность, а не только HTTP 200.
    const body = await res.json()
    return body?.service === "NurChat Server"
  } catch {
    return false
  }
}

export function getLocalPolicy(): Promise<HostPolicy> {
  return localJson<HostPolicy>("/api/host/config")
}

async function postLocal(path: string): Promise<HostPolicy> {
  const token = await localCsrfToken()
  return localJson<HostPolicy>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: "{}",
  })
}

/** Закрыть регистрацию и получить код приглашения. */
export function enableInviteOnly(): Promise<HostPolicy> {
  return postLocal("/api/host/invite")
}

/** Снова открыть регистрацию (код перестаёт требоваться). */
export function openRegistration(): Promise<HostPolicy> {
  return postLocal("/api/host/open")
}

export function startHost(): Promise<HostStatus> {
  return platform.invoke<HostStatus>("host_start")
}

export async function stopHost(): Promise<void> {
  await platform.invoke("host_stop")
}

export function getHostStatus(): Promise<HostStatus> {
  return platform.invoke<HostStatus>("host_status")
}

export function getHostAutostart(): Promise<boolean> {
  return platform.invoke<boolean>("host_autostart_get")
}

export function setHostAutostart(enabled: boolean): Promise<void> {
  return platform.invoke("host_autostart_set", { enabled })
}

/** Свой cloudflared (macOS/ARM или если автозагрузка недоступна). */
export async function getCloudflaredPath(): Promise<string | null> {
  return platform.invoke<string | null>("host_cloudflared_get")
}

/** null — сбросить и вернуться к автопоиску/загрузке. */
export async function setCloudflaredPath(path: string | null): Promise<void> {
  await platform.invoke("host_cloudflared_set", { path })
}

/** Подписка на прогресс; возвращает функцию отписки. */
export async function onHostStatus(callback: (status: HostStatus) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")
  return listen<HostStatus>("host-status", (event) => callback(event.payload))
}
