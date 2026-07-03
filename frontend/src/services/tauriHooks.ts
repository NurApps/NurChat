import { useState, useCallback } from "react"

interface IpfsAddResult {
  name: string
  hash: string
  size: string
}

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

export function useIpfs() {
  const [online, setOnline] = useState(false)
  const [pins, setPins] = useState<string[]>([])

  const initIpfs = useCallback(async (apiUrl?: string) => {
    try {
      const isOnline = await invoke<boolean>("init_ipfs", { api_url: apiUrl })
      setOnline(isOnline)
      return isOnline
    } catch (e) {
      console.error("IPFS init failed:", e)
      setOnline(false)
      return false
    }
  }, [])

  const addFile = useCallback(async (filePath: string): Promise<IpfsAddResult | null> => {
    try {
      return await invoke<IpfsAddResult>("ipfs_add_file", { file_path: filePath })
    } catch (e) {
      console.error("IPFS add file failed:", e)
      return null
    }
  }, [])

  const cat = useCallback(async (hash: string): Promise<Uint8Array | null> => {
    try {
      const data = await invoke<number[]>("ipfs_cat", { hash })
      return new Uint8Array(data)
    } catch (e) {
      console.error("IPFS cat failed:", e)
      return null
    }
  }, [])

  const pin = useCallback(async (hash: string): Promise<boolean> => {
    try {
      await invoke("ipfs_pin", { hash })
      return true
    } catch (e) {
      console.error("IPFS pin failed:", e)
      return false
    }
  }, [])

  const unpin = useCallback(async (hash: string): Promise<boolean> => {
    try {
      await invoke("ipfs_unpin", { hash })
      return true
    } catch (e) {
      console.error("IPFS unpin failed:", e)
      return false
    }
  }, [])

  const listPins = useCallback(async () => {
    try {
      const result = await invoke<string[]>("ipfs_list_pins")
      setPins(result)
      return result
    } catch (e) {
      console.error("IPFS list pins failed:", e)
      return []
    }
  }, [])

  const checkOnline = useCallback(async () => {
    try {
      const isOnline = await invoke<boolean>("ipfs_is_online")
      setOnline(isOnline)
      return isOnline
    } catch (e) {
      console.error("IPFS check online failed:", e)
      setOnline(false)
      return false
    }
  }, [])

  return { online, pins, initIpfs, addFile, cat, pin, unpin, listPins, checkOnline }
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
