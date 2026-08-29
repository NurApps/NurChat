/**
 * CANONICAL P2P Service - manages P2P node lifecycle and messaging
 * Integrates with Tauri commands (p2p-lib Rust crate) for direct TCP connections.
 * In browser mode, falls back to WebRTC data channels via signaling server.
 */

import { loadKeys } from "./e2e"
import { detectNat, type NatInfo, type NatType } from "./webrtcTransport"

export type { NatInfo, NatType }

export interface P2PPeer {
  peer_id: string
  public_key: string
  address: string
  port: number
}

export interface P2PDirectMessage {
  type: string
  from: string
  payload: string
}

function isTauri(): boolean {
  try {
    return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

let initialized = false
let myPort = 0
let messageUnlisten: (() => void) | null = null
let natInfo: NatInfo | null = null

export function isBrowserMode(): boolean {
  return !isTauri()
}

export async function initP2P(): Promise<number> {
  if (initialized) return myPort
  if (!isTauri()) {
    initialized = true
    return 0
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const keys = await loadKeys()
    const peerId = keys?.publicKeyHex
    // Deterministic transport identity: ECDH handshake key == identity key
    myPort = await invoke<number>("init_p2p", {
      listenPort: 0,
      peerId,
      identitySecretHex: keys?.privateKeyHex || null,
    })
    initialized = true
    return myPort
  } catch {
    initialized = true
    return 0
  }
}

export async function getNatInfo(): Promise<NatInfo | null> {
  if (natInfo) return natInfo
  if (!isTauri()) {
    natInfo = {
      nat_type: "unknown",
      public_ip: "",
      public_port: 0,
      local_ip: "",
      local_port: 0,
    }
    return natInfo
  }
  try {
    natInfo = await detectNat()
    return natInfo
  } catch {
    return null
  }
}

export async function getMyPort(): Promise<number> {
  if (!initialized) await initP2P()
  return myPort
}

export async function onP2PMessage(
  handler: (msg: P2PDirectMessage) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {}
  }
  await initP2P()
  if (messageUnlisten) messageUnlisten()
  const { listen } = await import("@tauri-apps/api/event")
  messageUnlisten = await listen<P2PDirectMessage>("p2p-message", (event) => {
    handler(event.payload)
  })
  return async () => {
    if (messageUnlisten) {
      messageUnlisten()
      messageUnlisten = null
    }
  }
}

export async function getPeers(): Promise<P2PPeer[]> {
  if (!isTauri()) return []
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<P2PPeer[]>("p2p_get_peers")
  } catch {
    return []
  }
}

export async function getPeerCount(): Promise<number> {
  if (!isTauri()) return 0
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<number>("p2p_get_peer_count")
  } catch {
    return 0
  }
}

export async function connectToPeer(address: string, port: number, publicKey: string): Promise<void> {
  if (!isTauri()) throw new Error("TCP P2P is not available in browser mode")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("p2p_connect_peer", { address, port, publicKey })
}

export async function sendP2PMessage(target: string, payload: string): Promise<void> {
  if (!isTauri()) throw new Error("TCP P2P is not available in browser mode")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("p2p_send_message", { target, payload })
}

export async function sendP2PFile(target: string, fileId: string, fileName: string, fileData: number[], mimeType: string): Promise<void> {
  if (!isTauri()) throw new Error("TCP P2P is not available in browser mode")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("p2p_send_file", { target, fileId, fileName, fileData, mimeType })
}

export async function sendP2PGroup(groupId: string, msgId: string, payload: string): Promise<void> {
  if (!isTauri()) throw new Error("TCP P2P is not available in browser mode")
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("p2p_send_group", { groupId, msgId, payload })
}

export async function startLANDiscovery(): Promise<void> {
  if (!isTauri()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_start_lan_discovery")
  } catch {}
}

export async function getLocalIP(): Promise<string> {
  if (!isTauri()) return "127.0.0.1"
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<string>("get_local_ip")
  } catch {
    return "127.0.0.1"
  }
}

export function generateInviteLink(publicKeyHex: string, port: number, ip = "127.0.0.1"): string {
  return `nurchat://${ip}:${port}#${publicKeyHex}`
}

export function generateTunnelInviteLink(publicKeyHex: string, tunnelHost: string): string {
  // Use port 443 for HTTPS tunnel — friend's app will connect via relay
  return `nurchat://${tunnelHost}:443#${publicKeyHex}`
}

export function parseInviteLink(link: string): { ip: string; port: number; publicKey: string; userId?: string } | null {
  try {
    const withoutProtocol = link.replace("nurchat://", "")
    const [addressPart, publicKey = ""] = withoutProtocol.split("#")

    // Handle domain:port or ip:port formats
    // For domains like xxxx.trycloudflare.com:443, split on last colon
    const lastColon = addressPart.lastIndexOf(":")
    if (lastColon === -1) return null

    const address = addressPart.substring(0, lastColon)
    const portStr = addressPart.substring(lastColon + 1)

    // Extract user_id if present (format: address:port/user_id)
    const slashIdx = portStr.indexOf("/")
    const port = parseInt(slashIdx === -1 ? portStr : portStr.substring(0, slashIdx), 10)
    const userId = slashIdx === -1 ? undefined : portStr.substring(slashIdx + 1)

    return { ip: address, port, publicKey, userId }
  } catch {
    return null
  }
}
