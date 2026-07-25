import { WS_BASE } from "../config"

const P2P_WS_URL = `${WS_BASE}/p2p`
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

export interface P2PPeer {
  user_id: string
  username: string
  peer_id: string
  public_key: string
  signing_public_key?: string
  is_online: boolean
}

export interface P2PMessage {
  id: string
  sender_id: string
  payload: string
  created_at: string
}

type P2PEventType = "peer_found" | "peer_lost" | "message_received" | "message_delivered" | "signaling" | "connected" | "disconnected" | "error" | "peer_connected" | "peer_disconnected" | "file_received_start" | "file_received" | "file_sent"

interface P2PEvent {
  type: P2PEventType
  data?: any
}

function getP2PKeys(): { privateKey: string; publicKey: string; signingPrivateKey: string; signingPublicKey: string } {
  try {
    const keys = JSON.parse(localStorage.getItem("p2p_keys") || "null")
    return {
      privateKey: keys?.private_key || "",
      publicKey: keys?.public_key || "",
      signingPrivateKey: keys?.signing_private_key || "",
      signingPublicKey: keys?.signing_public_key || "",
    }
  } catch {
    return { privateKey: "", publicKey: "", signingPrivateKey: "", signingPublicKey: "" }
  }
}

interface QueuedMessage {
  targetUserId: string
  messageId: string
  content: string
  timestamp: string
}

class P2PClient {
  private ws: WebSocket | null = null
  private userId: string = ""
  private token: string = ""
  private listeners: Map<string, Set<(event: P2PEvent) => void>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private connected = false
  private _onlinePeers: Set<string> = new Set()
  private _directPeers: Set<string> = new Set()
  private _connectingPeers: Set<string> = new Set()

  private peerConnections: Map<string, RTCPeerConnection> = new Map()
  private dataChannels: Map<string, RTCDataChannel> = new Map()
  private pendingCandidates: Map<string, RTCIceCandidate[]> = new Map()
  private peerReconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private peerReconnectAttempts: Map<string, number> = new Map()
  private queuedMessages: QueuedMessage[] = []
  private _incomingFiles: Map<string, any> = new Map()

  connect(userId: string, token: string) {
    this.userId = userId
    this.token = token
    this._loadQueuedMessages()
    this._connect()
  }

  private _connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    this.ws = new WebSocket(`${P2P_WS_URL}/${this.userId}?token=${encodeURIComponent(this.token)}`)

    this.ws.onopen = () => {
      this.connected = true
      this.reconnectAttempts = 0
      this._emit({ type: "connected" })
      this.sendHello()
      this._flushQueuedMessages()
    }

    this.ws.onclose = () => {
      this.connected = false
      this._emit({ type: "disconnected" })
      const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts))
      this.reconnectAttempts++
      this.reconnectTimer = setTimeout(() => this._connect(), delay)
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this._handleMessage(msg)
      } catch (e) { console.error("[P2P] WS message parse error:", e) }
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.peerReconnectTimers.forEach((t) => clearTimeout(t))
    this.peerReconnectTimers.clear()
    this.ws?.close()
    this.ws = null
    this.connected = false
    this.reconnectAttempts = 0
    this.dataChannels.forEach((dc) => dc.close())
    this.peerConnections.forEach((pc) => pc.close())
    this.dataChannels.clear()
    this.peerConnections.clear()
    this._directPeers.clear()
    this._connectingPeers.clear()
  }

  // ─── WebRTC DataChannel ───

  async initiateDirectConnection(targetUserId: string) {
    if (this.peerConnections.has(targetUserId) || this._connectingPeers.has(targetUserId)) return
    if (!this._onlinePeers.has(targetUserId)) return

    this._connectingPeers.add(targetUserId)
    console.log("[P2P] Initiating DataChannel to", targetUserId)

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.peerConnections.set(targetUserId, pc)

    const dc = pc.createDataChannel("p2p", { ordered: true })
    this._setupDataChannel(targetUserId, dc)

    this._setupPeerConnectionHandlers(targetUserId, pc)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.send({
        type: "p2p-signaling",
        target_user_id: targetUserId,
        data: { type: "offer", sdp: pc.localDescription!.toJSON() },
      })
    } catch (err) {
      console.error("[P2P] Failed to create offer:", err)
      this._connectingPeers.delete(targetUserId)
      this._schedulePeerReconnect(targetUserId)
    }
  }

  private _setupPeerConnectionHandlers(targetUserId: string, pc: RTCPeerConnection) {
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "p2p-signaling",
          target_user_id: targetUserId,
          data: { type: "ice-candidate", candidate: e.candidate.toJSON() },
        })
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      console.log(`[P2P] PC state with ${targetUserId}:`, state)
      if (state === "connected") {
        this._directPeers.add(targetUserId)
        this._connectingPeers.delete(targetUserId)
        this.peerReconnectAttempts.delete(targetUserId)
        this._emit({ type: "peer_connected", data: { user_id: targetUserId } })
      } else if (state === "failed") {
        console.log("[P2P] Connection failed with", targetUserId, "— restarting ICE")
        this._directPeers.delete(targetUserId)
        this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
        this._restartIce(targetUserId)
      } else if (state === "disconnected") {
        console.log("[P2P] Disconnected from", targetUserId, "— waiting...")
        setTimeout(() => {
          if (pc.connectionState === "disconnected") {
            this._directPeers.delete(targetUserId)
            this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
            this._cleanupPeer(targetUserId)
            this._schedulePeerReconnect(targetUserId)
          }
        }, 5000)
      } else if (state === "closed") {
        this._directPeers.delete(targetUserId)
        this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
      }
    }
  }

  private async _restartIce(targetUserId: string) {
    const pc = this.peerConnections.get(targetUserId)
    if (!pc) return

    try {
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      this.send({
        type: "p2p-signaling",
        target_user_id: targetUserId,
        data: { type: "offer", sdp: pc.localDescription!.toJSON() },
      })
    } catch (err) {
      console.error("[P2P] ICE restart failed:", err)
      this._cleanupPeer(targetUserId)
      this._schedulePeerReconnect(targetUserId)
    }
  }

  private _schedulePeerReconnect(targetUserId: string) {
    if (this.peerReconnectTimers.has(targetUserId)) return

    const attempts = this.peerReconnectAttempts.get(targetUserId) || 0
    if (attempts >= 5) {
      console.log("[P2P] Max reconnect attempts for", targetUserId)
      return
    }

    const delay = Math.min(30000, 1000 * Math.pow(2, attempts))
    this.peerReconnectAttempts.set(targetUserId, attempts + 1)

    console.log(`[P2P] Scheduling reconnect to ${targetUserId} in ${delay}ms (attempt ${attempts + 1})`)
    this.peerReconnectTimers.set(targetUserId, setTimeout(() => {
      this.peerReconnectTimers.delete(targetUserId)
      if (this._onlinePeers.has(targetUserId)) {
        this.initiateDirectConnection(targetUserId)
      }
    }, delay))
  }

  async handleSignaling(senderUserId: string, data: any) {
    if (data.type === "offer") {
      await this._handleOffer(senderUserId, data)
    } else if (data.type === "answer") {
      await this._handleAnswer(senderUserId, data)
    } else if (data.type === "ice-candidate") {
      await this._handleIceCandidate(senderUserId, data)
    }
  }

  private async _handleOffer(senderUserId: string, data: any) {
    let pc = this.peerConnections.get(senderUserId)
    if (pc && pc.signalingState === "have-local-offer") {
      if (this.userId > senderUserId) {
        this._cleanupPeer(senderUserId)
        pc = undefined
      } else {
        return
      }
    }

    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      this.peerConnections.set(senderUserId, pc)

      pc.ondatachannel = (e) => {
        this._setupDataChannel(senderUserId, e.channel)
      }

      this._setupPeerConnectionHandlers(senderUserId, pc)
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.send({
        type: "p2p-signaling",
        target_user_id: senderUserId,
        data: { type: "answer", sdp: pc.localDescription!.toJSON() },
      })
      const pending = this.pendingCandidates.get(senderUserId) || []
      for (const c of pending) {
        await pc.addIceCandidate(c)
      }
      this.pendingCandidates.delete(senderUserId)
    } catch (err) {
      console.error("[P2P] Failed to handle offer:", err)
    }
  }

  private async _handleAnswer(senderUserId: string, data: any) {
    const pc = this.peerConnections.get(senderUserId)
    if (!pc) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      const pending = this.pendingCandidates.get(senderUserId) || []
      for (const c of pending) {
        await pc.addIceCandidate(c)
      }
      this.pendingCandidates.delete(senderUserId)
    } catch (err) {
      console.error("[P2P] Failed to handle answer:", err)
    }
  }

  private async _handleIceCandidate(senderUserId: string, data: any) {
    const pc = this.peerConnections.get(senderUserId)
    const candidate = new RTCIceCandidate(data.candidate)
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(candidate)
    } else {
      if (!this.pendingCandidates.has(senderUserId)) {
        this.pendingCandidates.set(senderUserId, [])
      }
      this.pendingCandidates.get(senderUserId)!.push(candidate)
    }
  }

  private _setupDataChannel(targetUserId: string, dc: RTCDataChannel) {
    this.dataChannels.set(targetUserId, dc)

    dc.onopen = () => {
      console.log("[P2P] DataChannel open with", targetUserId)
      this._directPeers.add(targetUserId)
      this._connectingPeers.delete(targetUserId)
      this._emit({ type: "peer_connected", data: { user_id: targetUserId } })
      this._flushQueuedMessagesForPeer(targetUserId)
    }

    dc.onclose = () => {
      console.log("[P2P] DataChannel closed with", targetUserId)
      this._directPeers.delete(targetUserId)
      this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
    }

    dc.onerror = (e) => {
      console.error("[P2P] DataChannel error with", targetUserId, e)
    }

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "p2p-message") {
          this._emit({ type: "message_received", data: msg.data })
        } else if (msg.type === "p2p-file-start") {
          this._incomingFiles.set(msg.data.file_id, {
            ...msg.data,
            chunks: new Map(),
          })
          this._emit({ type: "file_received_start", data: msg.data })
        } else if (msg.type === "p2p-file-chunk") {
          const file = this._incomingFiles.get(msg.data.file_id)
          if (file) {
            file.chunks.set(msg.data.chunk_index, new Uint8Array(msg.data.chunk_data))
          }
        } else if (msg.type === "p2p-file-end") {
          const file = this._incomingFiles.get(msg.data.file_id)
          if (file) {
            const sortedEntries = Array.from(file.chunks.entries()) as [number, Uint8Array][]
            sortedEntries.sort((a, b) => a[0] - b[0])
            const blob = new Blob(sortedEntries.map(e => e[1] as BlobPart), { type: file.file_type })
            const url = URL.createObjectURL(blob)
            this._emit({ type: "file_received", data: { ...file, url } })
            this._incomingFiles.delete(msg.data.file_id)
          }
        }
      } catch (err) {
        console.error("[P2P] DataChannel message parse error:", err)
      }
    }
  }

  private _cleanupPeer(userId: string) {
    const pc = this.peerConnections.get(userId)
    if (pc) {
      pc.close()
      this.peerConnections.delete(userId)
    }
    this.dataChannels.delete(userId)
    this.pendingCandidates.delete(userId)
    this._connectingPeers.delete(userId)
  }

  // ─── Message queuing ───

  private static MAX_QUEUE_SIZE = 100
  private static QUEUE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

  private _queueMessage(targetUserId: string, messageId: string, content: string) {
    this.queuedMessages.push({
      targetUserId,
      messageId,
      content,
      timestamp: new Date().toISOString(),
    })
    // Trim oldest if over limit
    if (this.queuedMessages.length > P2PClient.MAX_QUEUE_SIZE) {
      this.queuedMessages = this.queuedMessages.slice(-P2PClient.MAX_QUEUE_SIZE)
    }
    this._saveQueuedMessages()
  }

  private _flushQueuedMessages() {
    const toSend = [...this.queuedMessages]
    this.queuedMessages = []
    this._saveQueuedMessages()

    for (const msg of toSend) {
      if (this._directPeers.has(msg.targetUserId)) {
        const sent = this.sendDirectMessage(msg.targetUserId, msg.messageId, msg.content)
        if (!sent) {
          this.queuedMessages.push(msg)
        }
      } else if (this._onlinePeers.has(msg.targetUserId)) {
        this.initiateDirectConnection(msg.targetUserId)
        this.queuedMessages.push(msg)
      } else {
        this.queuedMessages.push(msg)
      }
    }
  }

  private _flushQueuedMessagesForPeer(peerId: string) {
    const remaining: QueuedMessage[] = []
    for (const msg of this.queuedMessages) {
      if (msg.targetUserId === peerId) {
        this.sendDirectMessage(peerId, msg.messageId, msg.content)
      } else {
        remaining.push(msg)
      }
    }
    this.queuedMessages = remaining
    this._saveQueuedMessages()
  }

  private _saveQueuedMessages() {
    try {
      localStorage.setItem("p2p_queued_messages", JSON.stringify(this.queuedMessages))
    } catch {}
  }

  private _loadQueuedMessages() {
    try {
      const stored = localStorage.getItem("p2p_queued_messages")
      if (stored) {
        const parsed: QueuedMessage[] = JSON.parse(stored)
        const now = Date.now()
        // Filter out expired messages
        this.queuedMessages = parsed.filter(m => {
          const age = now - new Date(m.timestamp).getTime()
          return age < P2PClient.QUEUE_TTL_MS
        })
      }
    } catch {}
  }

  // ─── Send methods ───

  sendDirectMessage(targetUserId: string, messageId: string, content: string): boolean {
    const dc = this.dataChannels.get(targetUserId)
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({
        type: "p2p-message",
        data: {
          message_id: messageId,
          sender_id: this.userId,
          content: content,
          timestamp: new Date().toISOString(),
        },
      }))
      return true
    }
    return false
  }

  sendMessageOrQueue(targetUserId: string, messageId: string, content: string): boolean {
    if (this.sendDirectMessage(targetUserId, messageId, content)) {
      return true
    }
    if (this._onlinePeers.has(targetUserId)) {
      this.initiateDirectConnection(targetUserId)
    }
    this._queueMessage(targetUserId, messageId, content)
    return false
  }

  async sendFile(targetUserId: string, file: File, onProgress?: (sent: number, total: number) => void): Promise<boolean> {
    const dc = this.dataChannels.get(targetUserId)
    if (dc && dc.readyState === "open") {
      return this._sendFileDirect(targetUserId, file, dc, onProgress)
    }
    return this._sendFileRelay(targetUserId, file, onProgress)
  }

  private async _sendFileDirect(targetUserId: string, file: File, dc: RTCDataChannel, onProgress?: (sent: number, total: number) => void): Promise<boolean> {
    const CHUNK_SIZE = 65536
    const fileId = crypto.randomUUID()
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    dc.send(JSON.stringify({
      type: "p2p-file-start",
      data: {
        file_id: fileId, sender_id: this.userId,
        filename: file.name, file_size: file.size,
        file_type: file.type, total_chunks, timestamp: new Date().toISOString(),
      },
    }))

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)
      const arrayBuffer = await chunk.arrayBuffer()
      dc.send(JSON.stringify({
        type: "p2p-file-chunk",
        data: { file_id: fileId, chunk_index: i, chunk_data: Array.from(new Uint8Array(arrayBuffer)) },
      }))
      onProgress?.(i + 1, totalChunks)
    }

    dc.send(JSON.stringify({
      type: "p2p-file-end",
      data: { file_id: fileId, filename: file.name, file_type: file.type, file_size: file.size },
    }))

    this._emit({ type: "file_sent", data: { file_id: fileId, filename: file.name, file_type: file.type, file_size: file.size, target_user_id: targetUserId } })
    return true
  }

  private async _sendFileRelay(targetUserId: string, file: File, onProgress?: (sent: number, total: number) => void): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false

    const CHUNK_SIZE = 65536
    const fileId = crypto.randomUUID()
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    this.send({
      type: "p2p-file-start",
      target_user_id: targetUserId,
      data: {
        file_id: fileId, sender_id: this.userId,
        filename: file.name, file_size: file.size,
        file_type: file.type, total_chunks, timestamp: new Date().toISOString(),
      },
    })

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)
      const arrayBuffer = await chunk.arrayBuffer()
      this.send({
        type: "p2p-file-chunk",
        target_user_id: targetUserId,
        data: { file_id: fileId, chunk_index: i, chunk_data: Array.from(new Uint8Array(arrayBuffer)) },
      })
      onProgress?.(i + 1, totalChunks)
    }

    this.send({
      type: "p2p-file-end",
      target_user_id: targetUserId,
      data: { file_id: fileId, filename: file.name, file_type: file.type, file_size: file.size },
    })

    this._emit({ type: "file_sent", data: { file_id: fileId, filename: file.name, file_type: file.type, file_size: file.size, target_user_id: targetUserId } })
    return true
  }

  // ─── WS methods ───

  private sendHello() {
    const keys = getP2PKeys()
    this.send({
      type: "p2p-hello",
      data: {
        peer_id: this.userId,
        public_key: keys.publicKey,
        signing_public_key: keys.signingPublicKey,
        capabilities: ["relay", "direct"],
      },
    })
  }

  send(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  requestSync(limit = 500) {
    this.send({ type: "p2p-sync", limit })
  }

  get onlinePeers(): ReadonlySet<string> {
    return this._onlinePeers
  }

  get directPeers(): ReadonlySet<string> {
    return this._directPeers
  }

  get connectingPeers(): ReadonlySet<string> {
    return this._connectingPeers
  }

  private _handleMessage(msg: any) {
    const type = msg.type
    const data = msg.data || {}

    switch (type) {
      case "p2p-hello-ack":
        break
      case "p2p-peer-online":
        this._onlinePeers.add(data.user_id)
        this._emit({ type: "peer_found", data: { user_id: data.user_id } })
        break
      case "p2p-peer-offline":
        this._onlinePeers.delete(data.user_id)
        this._emit({ type: "peer_lost", data: { user_id: data.user_id } })
        break
      case "p2p-deliver":
        this._emit({ type: "message_received", data })
        break
      case "p2p-delivered":
        this._emit({ type: "message_delivered", data })
        break
      case "p2p-queued":
        break
      case "p2p-signaling":
        this._emit({ type: "signaling", data })
        this.handleSignaling(data.sender_id, data)
        break
      case "p2p-sync":
        if (data.messages) {
          for (const m of data.messages) {
            this._emit({ type: "message_received", data: m })
          }
        }
        break
      case "p2p-file-start":
        this._handleRelayFileStart(data)
        break
      case "p2p-file-chunk":
        this._handleRelayFileChunk(data)
        break
      case "p2p-file-end":
        this._handleRelayFileEnd(data)
        break
      case "p2p-error":
        this._emit({ type: "error", data })
        break
    }
  }

  private _handleRelayFileStart(data: any) {
    this._incomingFiles.set(data.file_id, {
      ...data,
      chunks: new Map(),
    })
    this._emit({ type: "file_received_start", data })
  }

  private _handleRelayFileChunk(data: any) {
    const file = this._incomingFiles.get(data.file_id)
    if (file) {
      file.chunks.set(data.chunk_index, new Uint8Array(data.chunk_data))
    }
  }

  private _handleRelayFileEnd(data: any) {
    const file = this._incomingFiles.get(data.file_id)
    if (file) {
      const sortedEntries = Array.from(file.chunks.entries()) as [number, Uint8Array][]
      sortedEntries.sort((a, b) => a[0] - b[0])
      const blob = new Blob(sortedEntries.map(e => e[1] as BlobPart), { type: file.file_type })
      const url = URL.createObjectURL(blob)
      this._emit({ type: "file_received", data: { ...file, url } })
      this._incomingFiles.delete(data.file_id)
    }
  }

  on(listener: (event: P2PEvent) => void): () => void {
    const key = "*"
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key)!.add(listener)
    return () => this.listeners.get(key)?.delete(listener)
  }

  private _emit(event: P2PEvent) {
    this.listeners.get("*")?.forEach((l) => l(event))
  }

  get isConnected() {
    return this.connected
  }
}

export const p2pClient = new P2PClient()
