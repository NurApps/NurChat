/**
 * P2P Bridge — user_id ↔ peer_id mapping and event routing.
 * Connects the canonical TCP p2pService to the ChatPage UI.
 *
 * Legacy p2pClient used WebRTC + signaling; this module replaces it with
 * direct TCP via p2pService + Tauri events.
 */

import { initP2P, onP2PMessage, connectToPeer, sendP2PMessage, getPeers, type P2PPeer } from "./p2pService"

// ─── Types ───

export type P2PBridgeEvent =
  | { type: "peer_connected"; data: { user_id: string } }
  | { type: "peer_disconnected"; data: { user_id: string } }
  | { type: "message_received"; data: { sender_id: string; content: string; message_id?: string } }
  | { type: "file_received_start"; data: { sender_id: string; file_name: string; message_id: string } }
  | { type: "file_received"; data: { sender_id: string; file_id: string; message_id: string } }

type Listener = (event: P2PBridgeEvent) => void

// ─── State ───

const listeners = new Set<Listener>()
let unlistenP2P: (() => void) | null = null
let initialized = false

/**
 * peerId → userId mapping (public_key_hex → user_{sha256}).
 * Populated by registerPeer / discoverPeer.
 */
const peerToUser = new Map<string, string>()

/**
 * userId → peerId reverse mapping.
 */
const userToPeer = new Map<string, string>()

/**
 * Currently connected TCP peer_ids.
 */
const connectedPeers = new Set<string>()

/**
 * Message queue for offline peers (userId → queued payloads).
 */
const messageQueue = new Map<string, string[]>()

// ─── Listener management ───

function emit(event: P2PBridgeEvent) {
  for (const fn of listeners) {
    try { fn(event) } catch { /* ignore */ }
  }
}

export function onP2PBridgeEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── Peer registration ───

/**
 * Register a mapping: userId ↔ peerId (public_key_hex).
 * Call this when loading chat participants or from invite flow.
 */
export function registerPeer(userId: string, publicKeyHex: string) {
  peerToUser.set(publicKeyHex, userId)
  userToPeer.set(userId, publicKeyHex)
}

/**
 * Get peer_id for a user_id.
 */
export function getPeerId(userId: string): string | undefined {
  return userToPeer.get(userId)
}

/**
 * Get user_id for a peer_id.
 */
export function getUserId(peerId: string): string | undefined {
  return peerToUser.get(peerId)
}

/**
 * Check if a peer is currently connected via TCP.
 */
export function isPeerConnected(userId: string): boolean {
  const peerId = userToPeer.get(userId)
  return peerId ? connectedPeers.has(peerId) : false
}

/**
 * Get all connected user_ids.
 */
export function getConnectedUserIds(): string[] {
  return [...connectedPeers]
    .map(peerId => peerToUser.get(peerId))
    .filter((id): id is string => !!id)
}

// ─── Initialization ───

/**
 * Initialize the P2P bridge. Safe to call multiple times.
 */
export async function initP2PBridge(): Promise<void> {
  if (initialized) return
  initialized = true

  await initP2P()

  // Subscribe to inbound TCP messages
  unlistenP2P = await onP2PMessage(async (msg) => {
    const senderUserId = peerToUser.get(msg.from)
    if (!senderUserId) {
      console.warn("[P2P Bridge] Unknown peer:", msg.from)
      return
    }

    // Try to parse structured payload
    try {
      const parsed = JSON.parse(msg.payload)

      if (parsed.type === "chat_message") {
        emit({
          type: "message_received",
          data: {
            sender_id: senderUserId,
            content: parsed.content || "",
            message_id: parsed.message_id,
          },
        })
      } else if (parsed.type === "file_start") {
        emit({
          type: "file_received_start",
          data: {
            sender_id: senderUserId,
            file_name: parsed.file_name || "file",
            message_id: parsed.message_id || `msg_${Date.now()}`,
          },
        })
      } else if (parsed.type === "file_chunk") {
        emit({
          type: "file_received",
          data: {
            sender_id: senderUserId,
            file_id: parsed.file_id || "",
            message_id: parsed.message_id || "",
          },
        })
      }
    } catch {
      // Raw string payload — treat as plain message
      emit({
        type: "message_received",
        data: {
          sender_id: senderUserId,
          content: msg.payload,
        },
      })
    }
  })

  // Refresh connected peers list periodically
  _refreshConnectedPeers()
}

// ─── Connection management ───

/**
 * Connect to a peer by address/port/publicKey.
 * The publicKey is used as peer_id in TCP.
 */
export async function connectToUser(
  address: string,
  port: number,
  publicKeyHex: string,
): Promise<void> {
  await initP2PBridge()
  await connectToPeer(address, port, publicKeyHex)
  connectedPeers.add(publicKeyHex)
  const userId = peerToUser.get(publicKeyHex)
  if (userId) {
    emit({ type: "peer_connected", data: { user_id: userId } })
  }
}

/**
 * Refresh connected peers from p2pService.
 */
async function _refreshConnectedPeers(): Promise<void> {
  try {
    const tcpPeers = await getPeers()
    const currentIds = new Set(tcpPeers.map(p => p.peer_id))

    // Detect newly connected
    for (const peerId of currentIds) {
      if (!connectedPeers.has(peerId)) {
        connectedPeers.add(peerId)
        const userId = peerToUser.get(peerId)
        if (userId) {
          emit({ type: "peer_connected", data: { user_id: userId } })
        }
      }
    }

    // Detect disconnected
    for (const peerId of connectedPeers) {
      if (!currentIds.has(peerId)) {
        connectedPeers.delete(peerId)
        const userId = peerToUser.get(peerId)
        if (userId) {
          emit({ type: "peer_disconnected", data: { user_id: userId } })
        }
      }
    }
  } catch {
    // p2pService not available (web mode)
  }

  // Re-check periodically
  if (initialized) {
    setTimeout(_refreshConnectedPeers, 5000)
  }
}

// ─── Send text message ───

/**
 * Send a text message via P2P TCP.
 * If the peer is not connected, queue the message.
 * Returns true if sent immediately, false if queued.
 */
export function sendP2PTextMessage(userId: string, messageId: string, content: string): boolean {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) {
    // Queue for later delivery
    const queue = messageQueue.get(userId) || []
    queue.push(JSON.stringify({ type: "chat_message", message_id: messageId, content }))
    if (queue.length > 50) queue.shift() // cap
    messageQueue.set(userId, queue)
    return false
  }

  const payload = JSON.stringify({ type: "chat_message", message_id: messageId, content })
  sendP2PMessage(peerId, payload).catch(err => {
    console.error("[P2P Bridge] send failed:", err)
    // Re-queue
    const queue = messageQueue.get(userId) || []
    queue.push(payload)
    messageQueue.set(userId, queue)
  })
  return true
}

/**
 * Send a file start notification via P2P.
 */
export function sendP2PFileStart(userId: string, messageId: string, fileName: string): void {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return

  const payload = JSON.stringify({ type: "file_start", message_id: messageId, file_name: fileName })
  sendP2PMessage(peerId, payload).catch(() => {})
}

/**
 * Send a file received confirmation via P2P.
 */
export function sendP2PFileReceived(userId: string, messageId: string, fileId: string): void {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return

  const payload = JSON.stringify({ type: "file_chunk", message_id: messageId, file_id: fileId })
  sendP2PMessage(peerId, payload).catch(() => {})
}

// ─── Flush queued messages (called when a peer connects) ───

export function flushMessageQueue(userId: string): void {
  const queue = messageQueue.get(userId)
  if (!queue || queue.length === 0) return

  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return

  for (const payload of queue) {
    sendP2PMessage(peerId, payload).catch(() => {})
  }
  messageQueue.delete(userId)
}

// ─── Cleanup ───

export function destroyP2PBridge(): void {
  if (unlistenP2P) {
    unlistenP2P()
    unlistenP2P = null
  }
  initialized = false
  connectedPeers.clear()
  peerToUser.clear()
  userToPeer.clear()
  messageQueue.clear()
}
