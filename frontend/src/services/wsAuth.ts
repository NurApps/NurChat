import { WS_BASE } from "../config"
import { getAccessToken } from "./tokenVault"

/**
 * Open an authenticated WebSocket WITHOUT `?token=` in the URL (pentest #3).
 *
 * The JWT travels in `Sec-WebSocket-Protocol` (browsers can't set an
 * `Authorization` header on the upgrade request, but CAN offer
 * subprotocols); the relay echoes it back during the handshake. Query-param
 * auth stays server-side as a fallback for old clients only — new code
 * must not put tokens in URLs (proxy logs, history, crash reports).
 *
 * `queryFallback=true` forces the legacy `?token=` URL — used for exactly
 * one retry when the relay predates subprotocol auth (handshake then fails
 * with 1006 before ever opening).
 */
export function openAuthedSocket(path: string, queryFallback = false): WebSocket | null {
  const token = getAccessToken()
  if (!token) return null
  if (queryFallback) {
    return new WebSocket(`${WS_BASE}${path}?token=${encodeURIComponent(token)}`)
  }
  try {
    return new WebSocket(`${WS_BASE}${path}`, [token])
  } catch {
    return new WebSocket(`${WS_BASE}${path}?token=${encodeURIComponent(token)}`)
  }
}
