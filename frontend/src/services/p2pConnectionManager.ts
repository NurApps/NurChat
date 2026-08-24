import { WebRTCTransport, detectNat, type NatInfo, type NatType } from "./webrtcTransport"

function isTauri(): boolean {
  try {
    return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

export type TransportType = "lan-tcp" | "wan-tcp" | "webrtc" | "turn-relay"

export interface ConnectedPeer {
  peerId: string
  transport: TransportType
  address: string
  port: number
  natType?: NatType
}

interface P2PDirectMessage {
  type: string
  from: string
  payload: string
}

export class P2PConnectionManager {
  private peers: Map<string, ConnectedPeer> = new Map()
  private webrtc: WebRTCTransport
  private _messageHandler: ((msg: P2PDirectMessage) => void) | null = null
  private _fileHandler: ((msg: Record<string, unknown>) => void) | null = null
  private natInfo: NatInfo | null = null
  private myPeerId: string = ""
  private initialized = false
  private _unlisteners: (() => void)[] = []

  constructor() {
    this.webrtc = new WebRTCTransport()
  }

  async init(myPeerId: string, signalingUrl: string): Promise<void> {
    if (this.initialized) return
    this.myPeerId = myPeerId

    try {
      this.natInfo = await detectNat()
    } catch (e) {
      console.warn("[P2P Manager] NAT detection failed:", e)
    }

    try {
      await this.webrtc.init(myPeerId, signalingUrl)
    } catch (e) {
      console.warn("[P2P Manager] WebRTC init failed:", e)
    }

    this.initialized = true
  }

  getNatInfo(): NatInfo | null {
    return this.natInfo
  }

  async connect(peerId: string, peerAddress: string, peerPort: number, peerNatType?: NatType): Promise<void> {
    if (this.peers.has(peerId)) return

    const transport = this.selectTransport(peerAddress, peerNatType)

    if (transport === "webrtc" || !isTauri()) {
      try {
        await this.webrtc.connectToPeer(peerId)
        this.peers.set(peerId, {
          peerId,
          transport: "webrtc",
          address: peerAddress,
          port: peerPort,
          natType: peerNatType,
        })
      } catch (e) {
        console.warn("[P2P Manager] WebRTC connect failed:", e)
      }
      return
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("p2p_connect_peer", { address: peerAddress, port: peerPort, publicKey: peerId })
      this.peers.set(peerId, {
        peerId,
        transport,
        address: peerAddress,
        port: peerPort,
        natType: peerNatType,
      })
    } catch (e) {
      // Direct TCP failed — try a NAT hole punch (works when the remote has
      // a reachable public endpoint, e.g. via UPnP or full-cone NAT) before
      // falling back to WebRTC.
      if (isTauri() && !this.isLAN(peerAddress)) {
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const method = await invoke<string>("p2p_hole_punch", {
            localPort: 0,
            remotePublicIp: peerAddress,
            remotePublicPort: peerPort,
            remotePeerId: peerId,
            remoteNatType: peerNatType || "unknown",
          })
          console.info("[P2P Manager] Hole punch succeeded via", method)
          this.peers.set(peerId, {
            peerId,
            transport: "wan-tcp",
            address: peerAddress,
            port: peerPort,
            natType: peerNatType,
          })
          return
        } catch (e1) {
          console.warn("[P2P Manager] Hole punch failed:", e1)
        }
      }
      console.warn(`[P2P Manager] ${transport} failed, trying WebRTC:`, e)
      try {
        await this.webrtc.connectToPeer(peerId)
        this.peers.set(peerId, {
          peerId,
          transport: "webrtc",
          address: peerAddress,
          port: peerPort,
          natType: peerNatType,
        })
      } catch (e2) {
        console.warn("[P2P Manager] All transports failed:", e2)
      }
    }
  }

  private selectTransport(address: string, peerNatType?: NatType): TransportType {
    if (this.isLAN(address)) return "lan-tcp"

    if (!this.natInfo || !peerNatType) return "wan-tcp"

    if (this.natInfo.nat_type === "public" || peerNatType === "public") return "wan-tcp"

    if (this.natInfo.nat_type === "symmetric" || peerNatType === "symmetric") return "webrtc"

    return "wan-tcp"
  }

  private isLAN(address: string): boolean {
    return (
      address.startsWith("192.168.") ||
      address.startsWith("10.") ||
      (address.startsWith("172.") && (() => {
        const second = parseInt(address.split(".")[1] || "0", 10)
        return second >= 16 && second <= 31
      })()) ||
      address === "127.0.0.1" ||
      address === "localhost"
    )
  }

  async sendMessage(targetPeerId: string, payload: string): Promise<void> {
    const peer = this.peers.get(targetPeerId)

    if (peer?.transport === "webrtc") {
      await this.webrtc.sendMessage(targetPeerId, {
        type: "text",
        from: this.myPeerId,
        payload,
      })
      return
    }

    if (!isTauri()) throw new Error("TCP transport not available in browser mode")
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_message", { target: targetPeerId, payload })
  }

  async sendFile(targetPeerId: string, fileId: string, fileName: string, fileData: number[], mimeType: string): Promise<void> {
    const peer = this.peers.get(targetPeerId)

    if (peer?.transport === "webrtc") {
      const chunkSize = 16384
      const totalSize = fileData.length

      await this.webrtc.sendMessage(targetPeerId, {
        type: "file-start",
        from: this.myPeerId,
        file_id: fileId,
        file_name: fileName,
        file_size: totalSize,
        mime_type: mimeType,
      })

      for (let offset = 0; offset < totalSize; offset += chunkSize) {
        const chunk = fileData.slice(offset, offset + chunkSize)
        const bytes = new Uint8Array(chunk)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const encoded = btoa(binary)
        await this.webrtc.sendMessage(targetPeerId, {
          type: "file-chunk",
          from: this.myPeerId,
          file_id: fileId,
          offset,
          data: encoded,
        })
      }

      await this.webrtc.sendMessage(targetPeerId, {
        type: "file-end",
        from: this.myPeerId,
        file_id: fileId,
      })
      return
    }

    if (!isTauri()) throw new Error("TCP transport not available in browser mode")
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("p2p_send_file", { target: targetPeerId, fileId, fileName, fileData, mimeType })
  }

  onMessage(handler: (msg: P2PDirectMessage) => void): void {
    this._messageHandler = handler
    this.webrtc.onMessage((msg) => {
      if (msg.type === "text" && this._messageHandler) {
        this._messageHandler({
          type: "p2p-direct",
          from: msg.from,
          payload: msg.payload || "",
        })
      }
    })

    // Also listen for TCP messages from Rust (Tauri only)
    if (isTauri()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<P2PDirectMessage>("p2p-message", (event) => {
          if (this._messageHandler) {
            this._messageHandler(event.payload)
          }
        }).then((unlisten) => {
          this._unlisteners.push(unlisten)
        })
      }).catch(() => {})
    }
  }

  onFileEvent(handler: (msg: Record<string, unknown>) => void): void {
    this._fileHandler = handler
    this.webrtc.onFileMessage((msg) => {
      if (msg.type?.startsWith("file-") && this._fileHandler) {
        this._fileHandler({
          type: `p2p-${msg.type}`,
          from: msg.from,
          file_id: msg.file_id,
          file_name: msg.file_name,
          file_size: msg.file_size,
          mime_type: msg.mime_type,
          offset: msg.offset,
          data: msg.data,
        })
      }
    })
  }

  getConnectedPeers(): ConnectedPeer[] {
    const result: ConnectedPeer[] = Array.from(this.peers.values())

    for (const peerId of this.webrtc.connectedPeers) {
      if (!result.find((r) => r.peerId === peerId)) {
        result.push({
          peerId,
          transport: "webrtc",
          address: "",
          port: 0,
        })
      }
    }

    return result
  }

  isPeerConnected(peerId: string): boolean {
    return this.peers.has(peerId) || this.webrtc.connectedPeers.has(peerId)
  }

  disconnect(): void {
    this.webrtc.disconnect()
    this.peers.clear()
    this._messageHandler = null
    this._fileHandler = null
    for (const unlisten of this._unlisteners) {
      unlisten()
    }
    this._unlisteners = []
  }
}

export const connectionManager = new P2PConnectionManager()
