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

type P2PEventType = "peer_found" | "peer_lost" | "message_received" | "message_delivered" | "signaling" | "connected" | "disconnected" | "error" | "peer_connected" | "peer_disconnected"

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

class P2PClient {
  private ws: WebSocket | null = null
  private userId: string = ""
  private token: string = ""
  private listeners: Map<string, Set<(event: P2PEvent) => void>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false
  private _onlinePeers: Set<string> = new Set()
  private _directPeers: Set<string> = new Set()

  // WebRTC DataChannel connections
  private peerConnections: Map<string, RTCPeerConnection> = new Map()
  private dataChannels: Map<string, RTCDataChannel> = new Map()
  private pendingCandidates: Map<string, RTCIceCandidate[]> = new Map()
  private connectingPeers: Set<string> = new Set()

  connect(userId: string, token: string) {
    this.userId = userId
    this.token = token
    this._connect()
  }

  private _connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    this.ws = new WebSocket(`${P2P_WS_URL}/${this.userId}?token=${encodeURIComponent(this.token)}`)

    this.ws.onopen = () => {
      this.connected = true
      this._emit({ type: "connected" })
      this.sendHello()
    }

    this.ws.onclose = () => {
      this.connected = false
      this._emit({ type: "disconnected" })
      this.reconnectTimer = setTimeout(() => this._connect(), 5000)
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this._handleMessage(msg)
      } catch (e) { console.error("P2P WS message parse error:", e) }
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.connected = false
    // Close all DataChannel connections
    this.dataChannels.forEach((dc) => dc.close())
    this.peerConnections.forEach((pc) => pc.close())
    this.dataChannels.clear()
    this.peerConnections.clear()
    this._directPeers.clear()
  }

  // ─── WebRTC DataChannel ───

  async initiateDirectConnection(targetUserId: string) {
    if (this.peerConnections.has(targetUserId) || this.connectingPeers.has(targetUserId)) return
    this.connectingPeers.add(targetUserId)

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.peerConnections.set(targetUserId, pc)

    const dc = pc.createDataChannel("p2p", { ordered: true })
    this._setupDataChannel(targetUserId, dc)

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
      if (state === "connected") {
        this._directPeers.add(targetUserId)
        this._emit({ type: "peer_connected", data: { user_id: targetUserId } })
      } else if (state === "failed" || state === "disconnected" || state === "closed") {
        this._directPeers.delete(targetUserId)
        this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
        this._cleanupPeer(targetUserId)
      }
    }

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
      this._cleanupPeer(targetUserId)
    }
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
      // Collision - use role resolution (higher ID wins)
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

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.send({
            type: "p2p-signaling",
            target_user_id: senderUserId,
            data: { type: "ice-candidate", candidate: e.candidate.toJSON() },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc!.connectionState
        if (state === "connected") {
          this._directPeers.add(senderUserId)
          this._emit({ type: "peer_connected", data: { user_id: senderUserId } })
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          this._directPeers.delete(senderUserId)
          this._emit({ type: "peer_disconnected", data: { user_id: senderUserId } })
          this._cleanupPeer(senderUserId)
        }
      }
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
      // Process pending ICE candidates
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
      this._directPeers.add(targetUserId)
      this._emit({ type: "peer_connected", data: { user_id: targetUserId } })
    }

    dc.onclose = () => {
      this._directPeers.delete(targetUserId)
      this._emit({ type: "peer_disconnected", data: { user_id: targetUserId } })
    }

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "p2p-message") {
          this._emit({ type: "message_received", data: msg.data })
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
    this.connectingPeers.delete(userId)
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

  private _handleMessage(msg: any) {
    const type = msg.type
    const data = msg.data || {}

    switch (type) {
      case "p2p-hello-ack":
        break
      case "p2p-peer-online":
        this._onlinePeers.add(data.user_id)
        break
      case "p2p-peer-offline":
        this._onlinePeers.delete(data.user_id)
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
          for (const msg of data.messages) {
            this._emit({ type: "message_received", data: msg })
          }
        }
        break
      case "p2p-error":
        this._emit({ type: "error", data })
        break
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
