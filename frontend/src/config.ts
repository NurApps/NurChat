const DEFAULT_API_HOST = "127.0.0.1:8000"
const DEFAULT_API_PROTOCOL = "http"

const RELAY_HOST_KEY = "nurchat_relay_host"
const RELAY_PROTOCOL_KEY = "nurchat_relay_protocol"

export interface RelayConfig {
  host: string
  protocol: "http" | "https"
}

export function getRelayConfig(): RelayConfig {
  let host = import.meta.env.VITE_API_HOST || DEFAULT_API_HOST
  let protocol: "http" | "https" = import.meta.env.VITE_API_PROTOCOL === "https" ? "https" : "http"
  try {
    const savedHost = localStorage.getItem(RELAY_HOST_KEY)
    const savedProtocol = localStorage.getItem(RELAY_PROTOCOL_KEY)
    if (savedHost) host = savedHost
    if (savedProtocol === "https" || savedProtocol === "http") protocol = savedProtocol
  } catch { /* localStorage недоступен — используем env */ }
  return { host, protocol }
}

export function setRelayConfig(config: RelayConfig) {
  try {
    localStorage.setItem(RELAY_HOST_KEY, config.host)
    localStorage.setItem(RELAY_PROTOCOL_KEY, config.protocol)
  } catch { /* ignore */ }
}

export function resetRelayConfig() {
  try {
    localStorage.removeItem(RELAY_HOST_KEY)
    localStorage.removeItem(RELAY_PROTOCOL_KEY)
  } catch { /* ignore */ }
}

const { host: API_HOST, protocol: API_PROTOCOL } = getRelayConfig()
const WS_PROTOCOL = API_PROTOCOL === "https" ? "wss" : "ws"

export const BASE_URL = `${API_PROTOCOL}://${API_HOST}`
export const WS_BASE = `${WS_PROTOCOL}://${API_HOST}/ws`
export const MEDIA_URL = BASE_URL

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${BASE_URL}/${path.replace(/\\/g, "/")}`
}
