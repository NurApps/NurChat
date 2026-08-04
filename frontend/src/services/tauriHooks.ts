import { useState, useCallback } from "react"
import { platform } from "./platform"
import type { P2PPeerInfo } from "./platform"

export function useP2P() {
  const [peers, setPeers] = useState<P2PPeerInfo[]>([])
  const [peerCount, setPeerCount] = useState(0)

  const initP2p = useCallback(async (listenPort?: number) => {
    return platform.initP2P(listenPort)
  }, [])

  const getPeers = useCallback(async () => {
    const result = await platform.getP2PPeers()
    setPeers(result)
    return result
  }, [])

  const getPeerCount = useCallback(async () => {
    const count = await platform.getP2PPeerCount()
    setPeerCount(count)
    return count
  }, [])

  return { peers, peerCount, initP2p, getPeers, getPeerCount }
}
