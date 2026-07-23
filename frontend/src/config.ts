const API_HOST = import.meta.env.VITE_API_HOST || "127.0.0.1:8000"
const API_PROTOCOL = import.meta.env.VITE_API_PROTOCOL || "http"
const WS_PROTOCOL = API_PROTOCOL === "https" ? "wss" : "ws"

export const BASE_URL = `${API_PROTOCOL}://${API_HOST}`
export const WS_BASE = `${WS_PROTOCOL}://${API_HOST}/ws`
export const MEDIA_URL = BASE_URL

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${BASE_URL}/${path.replace(/\\/g, "/")}`
}
