import { WS_BASE } from "../config"

const P2P_WS_URL = `${WS_BASE}/p2p`

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

type P2PEventType = "peer_found" | "peer_lost" | "message_received" | "message_delivered" | "signaling" | "connected" | "disconnected" | "error"

interface P2PEvent {
  type: P2PEventType
  data?: any
}

function getP2PKeys(): { publicKey: string; signingPublicKey: string } {
  try {
    const keys = JSON.parse(localStorage.getItem("p2p_keys") || "null")
    return {
      publicKey: keys?.public_key || "",
      signingPublicKey: keys?.signing_public_key || "",
    }
  } catch {
    return { publicKey: "", signingPublicKey: "" }
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
  }

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

  sendEncryptedMessage(targetUserId: string, messageId: string, encryptedPayload: string) {
    this.send({
      type: "p2p-deliver",
      target_user_id: targetUserId,
      data: {
        message_id: messageId,
        payload: encryptedPayload,
      },
    })
  }

  sendSignaling(targetUserId: string, signalData: any) {
    this.send({
      type: "p2p-signaling",
      target_user_id: targetUserId,
      data: signalData,
    })
  }

  requestSync(limit = 500) {
    this.send({
      type: "p2p-sync",
      limit,
    })
  }

  get onlinePeers(): ReadonlySet<string> {
    return this._onlinePeers
  }

  private _handleMessage(msg: any) {
    const type = msg.type
    const data = msg.data || {}

    switch (type) {
      case "p2p-hello-ack":
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
