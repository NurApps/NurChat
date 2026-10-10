import { WS_BASE } from "../config"
import { getAccessToken } from "./tokenVault"

/**
 * Open an authenticated WebSocket WITHOUT `?token=` in the URL (pentest #3).
 *
 * The JWT travels in `Sec-WebSocket-Protocol` (browsers can't set an
 * `Authorization` header on the upgrade request, but CAN offer
 * subprotocols); the relay echoes it back during the handshake.
 * Query-param auth was removed server-side: `?token=` is rejected with
 * 4001, so there is no legacy path left to fall back to.
 */
export function openAuthedSocket(path: string): WebSocket | null {
  const token = getAccessToken()
  if (!token) return null
  return new WebSocket(`${WS_BASE}${path}`, [token])
}
