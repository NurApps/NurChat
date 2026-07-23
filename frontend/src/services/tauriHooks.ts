import { useState, useCallback } from "react"

interface P2PPeerInfo {
  peer_id: string
  public_key: string
  address: string
  port: number
}

async function invoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
  return tauriInvoke<T>(cmd, args)
}

export function useP2P() {
  const [peers, setPeers] = useState<P2PPeerInfo[]>([])
  const [peerCount, setPeerCount] = useState(0)

  const initP2p = useCallback(async (listenPort?: number) => {
    try {
      const port = await invoke<number>("init_p2p", { listen_port: listenPort })
      return port
    } catch (e) {
      console.error("P2P init failed:", e)
      return null
    }
  }, [])

  const getPeers = useCallback(async () => {
    try {
      const result = await invoke<P2PPeerInfo[]>("p2p_get_peers")
      setPeers(result)
      return result
    } catch (e) {
      console.error("P2P get peers failed:", e)
      return []
    }
  }, [])

  const getPeerCount = useCallback(async () => {
    try {
      const count = await invoke<number>("p2p_get_peer_count")
      setPeerCount(count)
      return count
    } catch (e) {
      console.error("P2P get peer count failed:", e)
      return 0
    }
  }, [])

  return { peers, peerCount, initP2p, getPeers, getPeerCount }
}
