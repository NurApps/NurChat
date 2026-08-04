/**
 * P2P Bridge — user_id ↔ peer_id mapping and event routing.
 * Connects the canonical TCP p2pService to the ChatPage UI.
 *
 * Supports text messages and file transfer via TCP.
 * Files are sent as base64-encoded chunks (64KB each) through Rust p2p-lib.
 * Known peers are persisted in localStorage and auto-reconnected on startup.
 */

import {
  initP2P,
  onP2PMessage,
  sendP2PFile,
  sendP2PGroup,
  connectToPeer,
  sendP2PMessage,
  getPeers,
  type P2PPeer,
} from "./p2pService"
import { initCallSignaling } from "./callService"

// ─── Types ───

export type P2PBridgeEvent =
  | { type: "peer_connected"; data: { user_id: string } }
  | { type: "peer_disconnected"; data: { user_id: string } }
  | { type: "message_received"; data: { sender_id: string; content: string; message_id?: string } }
  | { type: "group_received"; data: { sender_id: string; group_id: string; msg_id: string; content: string } }
  | { type: "file_received"; data: { sender_id: string; file_id: string; file_name: string; file_size: number; mime_type: string; file_data: Uint8Array } }
  | { type: "reaction_received"; data: { sender_id: string; msg_id: string; emoji: string; add: boolean } }
  | { type: "typing_received"; data: { sender_id: string; chat_id: string; is_typing: boolean } }
  | { type: "online_status_received"; data: { sender_id: string; is_online: boolean } }
  | { type: "message_edit_received"; data: { sender_id: string; msg_id: string; new_content: string } }
  | { type: "message_delete_received"; data: { sender_id: string; msg_id: string; delete_for_all: boolean } }

type Listener = (event: P2PBridgeEvent) => void

interface KnownPeer {
  userId: string
  address: string
  port: number
  publicKey: string
}

// ─── File assembly state ───

interface IncomingFile {
  sender_id: string
  file_id: string
  file_name: string
  file_size: number
  mime_type: string
  chunks: Map<number, Uint8Array>
  total_received: number
}

const incomingFiles = new Map<string, IncomingFile>()

// ─── State ───

const listeners = new Set<Listener>()
let unlistenP2P: (() => void) | null = null
let unlistenFile: (() => void) | null = null
let initialized = false

const peerToUser = new Map<string, string>()
const userToPeer = new Map<string, string>()
const connectedPeers = new Set<string>()
const messageQueue = new Map<string, string[]>()

const KNOWN_PEERS_KEY = "p2p_known_peers"

// ─── Known peers persistence ───

function loadKnownPeers(): KnownPeer[] {
  try {
    const raw = localStorage.getItem(KNOWN_PEERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveKnownPeers(peers: KnownPeer[]): void {
  localStorage.setItem(KNOWN_PEERS_KEY, JSON.stringify(peers))
}

/**
 * Save a peer to persistent storage for auto-reconnect on next startup.
 */
export function saveKnownPeer(userId: string, address: string, port: number, publicKey: string): void {
  const peers = loadKnownPeers()
  const existing = peers.findIndex(p => p.userId === userId)
  const entry: KnownPeer = { userId, address, port, publicKey }
  if (existing >= 0) {
    peers[existing] = entry
  } else {
    peers.push(entry)
  }
  saveKnownPeers(peers)
}

/**
 * Remove a peer from persistent storage.
 */
export function removeKnownPeer(userId: string): void {
  const peers = loadKnownPeers().filter(p => p.userId !== userId)
  saveKnownPeers(peers)
}

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

export function registerPeer(userId: string, publicKeyHex: string) {
  peerToUser.set(publicKeyHex, userId)
  userToPeer.set(userId, publicKeyHex)
}

export function getPeerId(userId: string): string | undefined {
  return userToPeer.get(userId)
}

export function getUserId(peerId: string): string | undefined {
  return peerToUser.get(peerId)
}

export function isPeerConnected(userId: string): boolean {
  const peerId = userToPeer.get(userId)
  return peerId ? connectedPeers.has(peerId) : false
}

export function getConnectedUserIds(): string[] {
  return [...connectedPeers]
    .map(peerId => peerToUser.get(peerId))
    .filter((id): id is string => !!id)
}

// ─── Initialization ───

export async function initP2PBridge(): Promise<void> {
  if (initialized) return
  initialized = true

  await initP2P()

  // Subscribe to inbound TCP text messages
  unlistenP2P = await onP2PMessage(async (msg) => {
    const senderUserId = peerToUser.get(msg.from)
    if (!senderUserId) {
      console.warn("[P2P Bridge] Unknown peer:", msg.from)
      return
    }

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
      }
    } catch {
      emit({
        type: "message_received",
        data: {
          sender_id: senderUserId,
          content: msg.payload,
        },
      })
    }
  })

  // Subscribe to inbound TCP file and group events
  unlistenFile = onP2PFileEvent((payload) => {
    const type = payload.type as string
    const from = payload.from as string
    const senderUserId = peerToUser.get(from)
    if (!senderUserId) {
      console.warn("[P2P Bridge] Event from unknown peer:", from)
      return
    }

    if (type === "p2p-group-direct") {
      emit({
        type: "group_received",
        data: {
          sender_id: senderUserId,
          group_id: payload.group_id as string,
          msg_id: payload.msg_id as string,
          content: payload.payload as string,
        },
      })
    } else if (type === "p2p-file-start") {
      const fileId = payload.file_id as string
      incomingFiles.set(fileId, {
        sender_id: senderUserId,
        file_id: fileId,
        file_name: payload.file_name as string,
        file_size: payload.file_size as number,
        mime_type: payload.mime_type as string,
        chunks: new Map(),
        total_received: 0,
      })
    } else if (type === "p2p-file-chunk") {
      const fileId = payload.file_id as string
      const file = incomingFiles.get(fileId)
      if (file) {
        const offset = payload.offset as number
        const data = payload.data as string
        const binaryStr = atob(data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        file.chunks.set(offset, bytes)
        file.total_received += bytes.length
      }
    } else if (type === "p2p-file-end") {
      const fileId = payload.file_id as string
      const file = incomingFiles.get(fileId)
      if (file) {
        const sortedOffsets = [...file.chunks.keys()].sort((a, b) => a - b)
        const totalSize = sortedOffsets.reduce((sum, off) => sum + (file.chunks.get(off)?.length || 0), 0)
        const assembled = new Uint8Array(totalSize)
        let pos = 0
        for (const offset of sortedOffsets) {
          const chunk = file.chunks.get(offset)
          if (chunk) {
            assembled.set(chunk, pos)
            pos += chunk.length
          }
        }

        emit({
          type: "file_received",
          data: {
            sender_id: senderUserId,
            file_id: file.file_id,
            file_name: file.file_name,
            file_size: file.file_size,
            mime_type: file.mime_type,
            file_data: assembled,
          },
        })

        incomingFiles.delete(fileId)
      }
    } else if (type === "p2p-reaction") {
      emit({
        type: "reaction_received",
        data: {
          sender_id: senderUserId,
          msg_id: payload.msg_id as string,
          emoji: payload.emoji as string,
          add: payload.add as boolean,
        },
      })
    } else if (type === "p2p-typing") {
      emit({
        type: "typing_received",
        data: {
          sender_id: senderUserId,
          chat_id: payload.chat_id as string,
          is_typing: payload.is_typing as boolean,
        },
      })
    } else if (type === "p2p-online-status") {
      emit({
        type: "online_status_received",
        data: {
          sender_id: senderUserId,
          is_online: payload.is_online as boolean,
        },
      })
    } else if (type === "p2p-message-edit") {
      emit({
        type: "message_edit_received",
        data: {
          sender_id: senderUserId,
          msg_id: payload.msg_id as string,
          new_content: payload.new_content as string,
        },
      })
    } else if (type === "p2p-message-delete") {
      emit({
        type: "message_delete_received",
        data: {
          sender_id: senderUserId,
          msg_id: payload.msg_id as string,
          delete_for_all: payload.delete_for_all as boolean,
        },
      })
    }
  })

  // Auto-reconnect to known peers
  _autoConnectKnownPeers()

  // Initialize call signaling listener
  initCallSignaling()

  // Refresh connected peers list periodically
  _refreshConnectedPeers()
}

/**
 * Auto-connect to previously known peers on startup.
 * Silently ignores failures (peers may be offline).
 */
async function _autoConnectKnownPeers(): Promise<void> {
  const known = loadKnownPeers()
  for (const peer of known) {
    try {
      registerPeer(peer.userId, peer.publicKey)
      await connectToUser(peer.address, peer.port, peer.publicKey)
      console.log("[P2P Bridge] Auto-reconnected to:", peer.userId)
    } catch {
      // Peer may be offline — that's fine
    }
  }
}

function onP2PFileEvent(handler: (payload: Record<string, unknown>) => void): () => void {
  let unlisten: (() => void) | null = null
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen("p2p-message", (event) => {
      const payload = event.payload as Record<string, unknown>
      const type = payload.type as string
      if (type?.startsWith("p2p-file-")) {
        handler(payload)
      }
    }).then((fn) => { unlisten = fn })
  })
  return () => { unlisten?.() }
}

// ─── Connection management ───

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
    flushMessageQueue(userId)
  }
}

async function _refreshConnectedPeers(): Promise<void> {
  try {
    const tcpPeers = await getPeers()
    const currentIds = new Set(tcpPeers.map(p => p.peer_id))

    for (const peerId of currentIds) {
      if (!connectedPeers.has(peerId)) {
        connectedPeers.add(peerId)
        const userId = peerToUser.get(peerId)
        if (userId) {
          emit({ type: "peer_connected", data: { user_id: userId } })
          flushMessageQueue(userId)
        }
      }
    }

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

  if (initialized) {
    setTimeout(_refreshConnectedPeers, 5000)
  }
}

// ─── Send text message ───

export function sendP2PTextMessage(userId: string, messageId: string, content: string, replyToId?: string): boolean {
  const peerId = userToPeer.get(userId)
  const payload = JSON.stringify({ type: "chat_message", message_id: messageId, content, reply_to_id: replyToId || null })
  if (!peerId || !connectedPeers.has(peerId)) {
    const queue = messageQueue.get(userId) || []
    queue.push(payload)
    if (queue.length > 50) queue.shift()
    messageQueue.set(userId, queue)
    return false
  }

  sendP2PMessage(peerId, payload).catch(err => {
    console.error("[P2P Bridge] send failed:", err)
    const queue = messageQueue.get(userId) || []
    queue.push(payload)
    messageQueue.set(userId, queue)
  })
  return true
}

// ─── Send file via P2P TCP ───

export async function sendP2PFileMessage(
  userId: string,
  fileId: string,
  fileName: string,
  fileData: Uint8Array,
  mimeType: string,
): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) {
    console.warn("[P2P Bridge] Cannot send file — peer offline:", userId)
    return false
  }

  try {
    await sendP2PFile(peerId, fileId, fileName, Array.from(fileData), mimeType)
    return true
  } catch (err) {
    console.error("[P2P Bridge] File send failed:", err)
    return false
  }
}

// ─── Send group message via P2P TCP ───

/**
 * Send an encrypted group message to all connected peers via TCP mesh.
 * The message is broadcast by Rust p2p-lib to all connected peers,
 * who then forward it to their own peers (with dedup).
 */
export async function sendP2PGroupMessage(
  groupId: string,
  msgId: string,
  payload: string,
): Promise<boolean> {
  try {
    await sendP2PGroup(groupId, msgId, payload)
    return true
  } catch (err) {
    console.error("[P2P Bridge] Group send failed:", err)
    return false
  }
}

export async function sendP2PReaction(userId: string, msgId: string, emoji: string, add: boolean): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_reaction", { target: peerId, msgId, emoji, add })
    return true
  } catch (err) {
    console.error("[P2P Bridge] Reaction send failed:", err)
    return false
  }
}

export async function sendP2PTyping(userId: string, chatId: string, isTyping: boolean): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_typing", { target: peerId, chatId, isTyping })
    return true
  } catch (err) {
    console.error("[P2P Bridge] Typing send failed:", err)
    return false
  }
}

export async function sendP2POnlineStatus(userId: string, isOnline: boolean): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_online_status", { target: peerId, isOnline })
    return true
  } catch (err) {
    console.error("[P2P Bridge] Online status send failed:", err)
    return false
  }
}

export async function sendP2PMessageEdit(userId: string, msgId: string, newContent: string): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_message_edit", { target: peerId, msgId, newContent })
    return true
  } catch (err) {
    console.error("[P2P Bridge] Message edit send failed:", err)
    return false
  }
}

export async function sendP2PMessageDelete(userId: string, msgId: string, deleteForAll: boolean): Promise<boolean> {
  const peerId = userToPeer.get(userId)
  if (!peerId || !connectedPeers.has(peerId)) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_message_delete", { target: peerId, msgId, deleteForAll })
    return true
  } catch (err) {
    console.error("[P2P Bridge] Message delete send failed:", err)
    return false
  }
}

// ─── Flush queued messages ───

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
  if (unlistenFile) {
    unlistenFile()
    unlistenFile = null
  }
  initialized = false
  connectedPeers.clear()
  peerToUser.clear()
  userToPeer.clear()
  messageQueue.clear()
  incomingFiles.clear()
}
