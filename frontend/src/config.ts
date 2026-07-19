const API_HOST = import.meta.env.VITE_API_HOST || "127.0.0.1:8000"
const API_PROTOCOL = import.meta.env.VITE_API_PROTOCOL || "http"
const WS_PROTOCOL = API_PROTOCOL === "https" ? "wss" : "ws"

export const BASE_URL = `${API_PROTOCOL}://${API_HOST}`
export const WS_BASE = `${WS_PROTOCOL}://${API_HOST}/ws`
export const MEDIA_URL = BASE_URL

// IPFS gateway for content-addressed file retrieval
const IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || "http://127.0.0.1:8080"
export const ipfsGatewayUrl = (cid: string) => `${IPFS_GATEWAY}/ipfs/${cid}`

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return `${BASE_URL}/${path.replace(/\\/g, "/")}`
}
