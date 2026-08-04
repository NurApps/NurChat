/**
 * CANONICAL P2P Service - manages P2P node lifecycle and messaging
 * Integrates with Tauri commands (p2p-lib Rust crate) for direct TCP connections.
 * Replaces the legacy WebRTC stack in `./p2p.ts`.
 */

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { loadKeys } from "./e2e"

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

let initialized = false
let myPort = 0
let messageUnlisten: (() => void) | null = null

export async function initP2P(): Promise<number> {
  if (initialized) return myPort
  try {
    const keys = loadKeys()
    const peerId = keys?.publicKeyHex
    myPort = await invoke<number>("init_p2p", { listenPort: 0, peerId })
    initialized = true
    console.log("[P2P] Node started on port", myPort)
    return myPort
  } catch (err) {
    console.error("[P2P] Failed to init:", err)
    return 0
  }
}

// Subscribe to inbound P2P direct messages from the Rust/backend layer.
export async function onP2PMessage(
  handler: (msg: P2PDirectMessage) => void,
): Promise<() => void> {
  await initP2P()
  if (messageUnlisten) messageUnlisten()
  messageUnlisten = await listen<P2PDirectMessage>("p2p-message", (event) => {
    const payload = event.payload
    console.log("[P2P] message event:", payload)
    handler(payload)
  })
  return async () => {
    if (messageUnlisten) {
      messageUnlisten()
      messageUnlisten = null
    }
  }
}

export async function getMyPort(): Promise<number> {
  if (!initialized) await initP2P()
  return myPort
}

export async function getPeers(): Promise<P2PPeer[]> {
  return await invoke<P2PPeer[]>("p2p_get_peers")
}

export async function getPeerCount(): Promise<number> {
  return await invoke<number>("p2p_get_peer_count")
}

export async function connectToPeer(address: string, port: number, publicKey: string): Promise<void> {
  await invoke("p2p_connect_peer", { address, port, publicKey })
}

export async function sendP2PMessage(target: string, payload: string): Promise<void> {
  await invoke("p2p_send_message", { target, payload })
}

export async function sendP2PFile(target: string, fileId: string, fileName: string, fileData: number[], mimeType: string): Promise<void> {
  await invoke("p2p_send_file", { target, fileId, fileName, fileData, mimeType })
}

export async function sendP2PGroup(groupId: string, msgId: string, payload: string): Promise<void> {
  await invoke("p2p_send_group", { groupId, msgId, payload })
}

let fileUnlisten: UnlistenFn | null = null

export function onP2PFileEvent(handler: (payload: Record<string, unknown>) => void): () => void {
  if (!fileUnlisten) {
    listen("p2p-message", (event) => {
      const payload = event.payload as Record<string, unknown>
      const type = payload.type as string
      if (type?.startsWith("p2p-file-")) {
        handler(payload)
      }
    }).then((unlisten) => {
      fileUnlisten = unlisten
    })
  }
  return async () => {
    if (fileUnlisten) {
      fileUnlisten()
      fileUnlisten = null
    }
  }
}

export async function startLANDiscovery(): Promise<void> {
  await invoke("p2p_start_lan_discovery")
}

export async function getLocalIP(): Promise<string> {
  try {
    return await invoke<string>("get_local_ip")
  } catch {
    return "127.0.0.1"
  }
}

// Generate invite link
export function generateInviteLink(publicKeyHex: string, port: number, ip = "127.0.0.1"): string {
  return `nurchat://${ip}:${port}#${publicKeyHex}`
}

// Parse invite link
export function parseInviteLink(link: string): { ip: string; port: number; publicKey: string } | null {
  try {
    const withoutProtocol = link.replace("nurchat://", "")
    const [addressPart, publicKey] = withoutProtocol.split("#")
    const [ip, portStr] = addressPart.split(":")
    return { ip, port: parseInt(portStr, 10), publicKey }
  } catch {
    return null
  }
}
