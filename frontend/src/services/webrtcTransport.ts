export type NatType = "public" | "full_cone" | "restricted_cone" | "port_restricted" | "symmetric" | "unknown"

export interface NatInfo {
  nat_type: NatType
  public_ip: string
  public_port: number
  local_ip: string
  local_port: number
}

export interface PeerEndpoint {
  peer_id: string
  public_ip: string
  public_port: number
  nat_type: string
}

interface RTCMessage {
  type: "text" | "file-start" | "file-chunk" | "file-end"
  from: string
  payload?: string
  file_id?: string
  file_name?: string
  file_size?: number
  mime_type?: string
  offset?: number
  data?: string
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

let customIceServers: RTCIceServer[] | null = null

export async function loadIceServers(): Promise<RTCIceServer[]> {
  if (customIceServers) return customIceServers
  try {
    const apiHost = import.meta.env.VITE_API_HOST || "localhost:8000"
    const protocol = import.meta.env.VITE_API_PROTOCOL || "http"
    const resp = await fetch(`${protocol}://${apiHost}/api/calls/ice-servers`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
    })
    if (resp.ok) {
      const data = await resp.json()
      if (data.ice_servers?.length) {
        customIceServers = data.ice_servers
        return data.ice_servers
      }
    }
  } catch {}
  return DEFAULT_ICE_SERVERS
}

function isTauri(): boolean {
  try {
    return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

export async function detectNat(stunServers?: string[]): Promise<NatInfo> {
  if (!isTauri()) {
    return {
      nat_type: "unknown",
      public_ip: "",
      public_port: 0,
      local_ip: "",
      local_port: 0,
    }
  }
  const { invoke } = await import("@tauri-apps/api/core")
  return await invoke<NatInfo>("p2p_detect_nat", { stunServers })
}

export class WebRTCTransport {
  private pcs: Map<string, RTCPeerConnection> = new Map()
  private channels: Map<string, RTCDataChannel> = new Map()
  private messageHandlers: Map<string, (msg: RTCMessage) => void> = new Map()
  private _connectedPeers: Set<string> = new Set()
  private signalingWs: WebSocket | null = null
  private myPeerId: string = ""
  private _globalMessageHandler: ((msg: RTCMessage) => void) | null = null
  private _globalFileHandler: ((msg: RTCMessage) => void) | null = null
  private _unlisteners: (() => void)[] = []
  private negotiationState = new Map<string, { polite: boolean; makingOffer: boolean; ignoreOffer: boolean }>()
  private _controlHandler: ((msg: Record<string, unknown>) => void) | null = null

  get connectedPeers(): ReadonlySet<string> {
    return this._connectedPeers
  }

  async init(myPeerId: string, signalingUrl: string): Promise<void> {
    this.myPeerId = myPeerId

    await loadIceServers()

    try {
      this.signalingWs = new WebSocket(signalingUrl)

      this.signalingWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          this.handleSignalingMessage(data)
        } catch {}
      }

      this.signalingWs.onclose = () => {
        setTimeout(() => this.reconnectSignaling(signalingUrl), 3000)
      }

      await new Promise<void>((resolve, reject) => {
        if (this.signalingWs!.readyState === WebSocket.OPEN) {
          resolve()
        } else {
          this.signalingWs!.onopen = () => resolve()
          this.signalingWs!.onerror = () => reject(new Error("WebSocket connect failed"))
        }
      })
    } catch (e) {
      console.warn("[WebRTC] Signaling connect failed:", e)
    }
  }

  private reconnectSignaling(url: string): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) return
    try {
      this.signalingWs = new WebSocket(url)
      this.signalingWs.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          this.handleSignalingMessage(data)
        } catch {}
      }
      this.signalingWs.onclose = () => {
        setTimeout(() => this.reconnectSignaling(url), 3000)
      }
    } catch {}
  }

  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    const iceServers = customIceServers || DEFAULT_ICE_SERVERS
    const pc = new RTCPeerConnection({ iceServers })

    // Perfect negotiation: polite side rolls back on offer collisions,
    // impolite side ignores the incoming offer. Deterministic per pair.
    const polite = this.myPeerId < remotePeerId
    const neg = {
      polite,
      makingOffer: false,
      ignoreOffer: false,
    }
    this.negotiationState.set(remotePeerId, neg)

    pc.onnegotiationneeded = async () => {
      try {
        neg.makingOffer = true
        await pc.setLocalDescription()
        if (this.signalingWs?.readyState === WebSocket.OPEN && pc.localDescription) {
          this.signalingWs.send(JSON.stringify({
            type: "offer",
            from: this.myPeerId,
            to: remotePeerId,
            sdp: pc.localDescription,
          }))
        }
      } catch (e) {
        console.warn("[WebRTC] negotiation error:", e)
      } finally {
        neg.makingOffer = false
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && this.signalingWs?.readyState === WebSocket.OPEN) {
        this.signalingWs.send(JSON.stringify({
          type: "ice-candidate",
          from: this.myPeerId,
          to: remotePeerId,
          candidate: e.candidate.toJSON(),
        }))
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === "connected") {
        this._connectedPeers.add(remotePeerId)
      } else if (state === "failed" || state === "disconnected") {
        this._connectedPeers.delete(remotePeerId)
        this.cleanupPeer(remotePeerId)
      }
    }

    this.pcs.set(remotePeerId, pc)
    return pc
  }

  async connectToPeer(remotePeerId: string): Promise<void> {
    if (this.pcs.has(remotePeerId)) return

    const pc = this.createPeerConnection(remotePeerId)

    const dc = pc.createDataChannel("messages", { ordered: true })
    this.setupDataChannel(remotePeerId, dc)

    // Initial offer fires via onnegotiationneeded automatically after
    // createDataChannel — no manual createOffer needed here.
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    dc.onopen = () => {
      this._connectedPeers.add(peerId)
    }

    dc.onclose = () => {
      this._connectedPeers.delete(peerId)
    }

    dc.onmessage = (e) => {
      try {
        const msg: RTCMessage = JSON.parse(e.data)
        // Per-peer handler
        const handler = this.messageHandlers.get(peerId)
        if (handler) handler(msg)
        // Global message handler
        if (this._globalMessageHandler) this._globalMessageHandler(msg)
        // Global file handler for file-* messages
        if (this._globalFileHandler && msg.type?.startsWith("file-")) {
          this._globalFileHandler(msg)
        }
      } catch {}
    }

    this.channels.set(peerId, dc)
  }

  private async handleSignalingMessage(data: Record<string, unknown>): Promise<void> {
    const type = data.type as string
    const from = data.from as string

    if (type === "offer") {
      let pc = this.pcs.get(from)
      const neg = this.negotiationState.get(from)

      // Offer collision: an offer arrives while we are making our own
      // (signalingState !== stable). Impolite peer ignores it; polite peer
      // rolls back implicitly via setRemoteDescription.
      const collision = pc && (neg?.makingOffer || pc.signalingState !== "stable")
      if (!neg) {
        console.warn("[WebRTC] No negotiation state for peer", from)
        return
      }
      neg.ignoreOffer = !neg.polite && !!collision
      if (neg.ignoreOffer) {
        console.info("[WebRTC] Ignoring offer collision (impolite)")
        return
      }

      if (!pc) {
        pc = this.createPeerConnection(from)
        const dc = pc.createDataChannel("messages", { ordered: true })
        this.setupDataChannel(from, dc)
      }

      await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit)

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      this.signalingWs?.send(JSON.stringify({
        type: "answer",
        from: this.myPeerId,
        to: from,
        sdp: answer,
      }))
    } else if (type === "answer") {
      const pc = this.pcs.get(from)
      if (!pc) return
      const neg = this.negotiationState.get(from)
      // Answer to a rolled-back offer — ignore stale answers
      if (pc.signalingState === "have-remote-offer" || pc.signalingState === "stable") {
        try {
          await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit)
        } catch (e) {
          if (!neg?.ignoreOffer) throw e
        }
      }
    } else if (type === "ice-candidate") {
      const pc = this.pcs.get(from)
      const neg = this.negotiationState.get(from)
      if (!pc || !data.candidate) return
      try {
        await pc.addIceCandidate(data.candidate as RTCIceCandidateInit)
      } catch (e) {
        // Candidates can arrive before the remote description during glare
        if (!neg?.ignoreOffer) console.warn("[WebRTC] addIceCandidate failed:", e)
      }
    } else if (type === "nat-info" || type === "punch-request") {
      // Control-plane messages for NAT traversal coordination
      this._controlHandler?.(data)
    }
  }

  /**
   * Send a control-plane message over the signaling channel
   * (used for NAT endpoint exchange and punch coordination).
   */
  sendControl(to: string, payload: Record<string, unknown>): boolean {
    if (this.signalingWs?.readyState !== WebSocket.OPEN) return false
    this.signalingWs.send(JSON.stringify({ from: this.myPeerId, to, ...payload }))
    return true
  }

  onControl(handler: ((msg: Record<string, unknown>) => void) | null): void {
    this._controlHandler = handler
  }

  async sendMessage(targetPeerId: string, msg: RTCMessage): Promise<void> {
    const dc = this.channels.get(targetPeerId)
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: (msg: RTCMessage) => void): void {
    this._globalMessageHandler = handler
  }

  onFileMessage(handler: (msg: RTCMessage) => void): void {
    this._globalFileHandler = handler
  }

  disconnect(): void {
    for (const [, pc] of this.pcs) {
      pc.close()
    }
    this.pcs.clear()
    this.channels.clear()
    this._connectedPeers.clear()
    this.messageHandlers.clear()
    this._globalMessageHandler = null
    this._globalFileHandler = null
    for (const unlisten of this._unlisteners) {
      unlisten()
    }
    this._unlisteners = []
    this.signalingWs?.close()
    this.signalingWs = null
  }

  private cleanupPeer(peerId: string): void {
    const pc = this.pcs.get(peerId)
    if (pc) {
      pc.close()
      this.pcs.delete(peerId)
    }
    this.channels.delete(peerId)
    this.messageHandlers.delete(peerId)
    this.negotiationState.delete(peerId)
  }
}
