import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { platform } from "../services/platform"
import styles from "./P2PShare.module.css"

interface RemotePeer {
  node_id: string
  address: string
  user_id: string
  connected_at: string
  is_relay?: boolean
}

interface RelayPeer {
  node_id: string
  address: string
  user_id: string
}

interface LanPeerInfo {
  node_id: string
  host: string
  port: number
  user_id: string
  username: string
  peer_name: string
  last_seen: string
}

export default function P2PShare() {
  const { t } = useTranslation()
  const [inviteUri, setInviteUri] = useState("")
  const [portOpen, setPortOpen] = useState(false)
  const [remoteInput, setRemoteInput] = useState("")
  const [relayInput, setRelayInput] = useState("")
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([])
  const [relayPeers, setRelayPeers] = useState<RelayPeer[]>([])
const [lanPeers, setLanPeers] = useState<LanPeerInfo[]>([])
  const [lanScanning, setLanScanning] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  const loadAddress = useCallback(async () => {
    try {
      const data = await api.getP2PAddress()
      setInviteUri(data.uri)
      setPortOpen(data.port_open)
    } catch { }
  }, [])

  const loadPeers = useCallback(async () => {
    try {
      const data = await api.getRemotePeers()
      setRemotePeers(data.peers || [])
    } catch { }
  }, [])

  const loadRelays = useCallback(async () => {
    try {
      const data = await api.getRelayPeers()
      setRelayPeers(data.relays || [])
    } catch { }
  }, [])

  useEffect(() => { loadAddress(); loadPeers(); loadRelays() }, [loadAddress, loadPeers, loadRelays])

  const handleOpenPort = async () => {
    setStatus(t("p2p.openingPort"))
    setError("")
    try {
      const data = await api.openP2PPort()
      setInviteUri(data.uri)
      setPortOpen(true)
      setStatus(t("p2p.portOpened"))
    } catch (e: any) {
      setError(e.message || t("p2p.portOpenFailed"))
      setStatus("")
    }
  }

  const handleConnectRemote = async () => {
    if (!remoteInput.trim()) return
    setStatus(t("p2p.connecting"))
    setError("")
    try {
      await api.connectToRemote(remoteInput.trim(), relayInput.trim() || undefined)
      setRemoteInput("")
      setStatus(t("p2p.connectSuccess"))
      loadPeers()
    } catch (e: any) {
      setError(e.message || t("p2p.connectFailedRemote"))
      setStatus("")
    }
  }

  const handleRegisterRelay = async () => {
    setError("")
    try {
      await api.registerRelay()
      setStatus(t("p2p.relayRegistered"))
      loadRelays()
    } catch (e: any) {
      setError(e.message || t("p2p.relayFailed"))
    }
  }

  const handleLanScan = async () => {
    setLanScanning(true)
    setError("")
    try {
      const data = await api.discoverLAN()
      setLanPeers(data.peers || [])
      if (!data.peers || data.peers.length === 0) {
        setStatus(t("p2p.nothingFound"))
      } else {
        setStatus(t("p2p.foundPeers", { count: data.peers.length }))
      }
    } catch (e: any) {
      setError(e.message || t("p2p.scanError"))
    } finally {
      setLanScanning(false)
    }
  }

  const handleConnectLan = (peer: LanPeerInfo) => {
    const uri = `nurchat://${peer.host}:${peer.port}/${peer.user_id || peer.node_id}`
    setRemoteInput(uri)
  }

  const openPort = () => {
    setStatus(t("p2p.openingPort"))
    setError("")
    handleOpenPort()
  }

  return (
    <div className={styles.container}>
      <h3>{t("p2p.connection")}</h3>

      <div className={styles.section}>
        {!portOpen ? (
          <button className={styles.openBtn} onClick={openPort} disabled={status === t("p2p.openingPort")}>
            {status === t("p2p.openingPort") ? "⏳" : "🔓"} {t("p2p.openPort")}
          </button>
        ) : (
            <div className={styles.uriBox}>
              <label>{t("p2p.yourInviteLink")}</label>
              <div className={styles.uri}>{inviteUri}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className={styles.copyBtn} onClick={() => { navigator.clipboard.writeText(inviteUri); setStatus(t("p2p.copiedStatus")) }}>
                  {t("p2p.copy")}
                </button>
                <button className={styles.shareBtn} onClick={async () => {
                  try { await platform.shareInvite(inviteUri); setStatus(t("p2p.sentStatus")) }
                  catch { setStatus(t("p2p.sendError")) }
                }}>
                  {t("p2p.sendToFriend")}
                </button>
              </div>
            <p className={styles.hint}>{t("p2p.sendLinkHint")}</p>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <label>{t("p2p.connectToFriendLabel")}</label>
        <div className={styles.connectRow}>
          <input
            type="text"
            placeholder="nurchat://ip:port/user_id#hash"
            value={remoteInput}
            onChange={(e) => setRemoteInput(e.target.value)}
            className={styles.input}
          />
          <button className={styles.connectBtn} onClick={handleConnectRemote} disabled={!remoteInput.trim()}>
            🔗 {t("p2p.connectBtn").replace("🔗 ", "")}
          </button>
        </div>
        <input
          type="text"
            placeholder={t("p2p.relayPlaceholder")}
          value={relayInput}
          onChange={(e) => setRelayInput(e.target.value)}
          className={styles.input}
          style={{ marginTop: 6 }}
        />
      </div>

      <div className={styles.section}>
        <label>{t("p2p.relayNAT")}</label>
        <button className={styles.scanBtn} onClick={handleRegisterRelay} style={{ background: "#7c3aed" }}>
          {t("p2p.becomeRelay")}
        </button>
        {relayPeers.length > 0 && (
          <ul className={styles.peerList} style={{ marginTop: 8 }}>
            {relayPeers.map((p) => (
              <li key={p.node_id} className={styles.peerItem}>
                <span>🔄 {p.user_id}</span>
                <span className={styles.peerAddr}>{p.address}</span>
                <button className={styles.smallBtn} onClick={() => setRelayInput(`nurchat://${p.address}/${p.user_id}`)}>
                  {t("p2p.useRelay")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <label>{t("p2p.lanNetwork")}</label>
        <button className={styles.scanBtn} onClick={handleLanScan} disabled={lanScanning}>
          {lanScanning ? t("p2p.scanning") : t("p2p.findLanBtn")}
        </button>
        {lanPeers.length > 0 && (
          <ul className={styles.peerList}>
            {lanPeers.map((p) => (
              <li key={p.node_id} className={styles.peerItem}>
                <span>💻 {p.peer_name}</span>
                <span className={styles.peerAddr}>{p.host}:{p.port}</span>
                <button className={styles.smallBtn} onClick={() => handleConnectLan(p)}>
                  {t("p2p.connectLan")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && <div className={styles.status}>{status}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {remotePeers.length > 0 && (
        <div className={styles.section}>
          <h4>{t("p2p.connectedPeers", { count: remotePeers.length })}</h4>
          <ul className={styles.peerList}>
            {remotePeers.map((p) => (
              <li key={p.node_id} className={styles.peerItem}>
                <span>{p.is_relay ? "🔄" : "🟢"} {p.user_id}</span>
                <span className={styles.peerAddr}>{p.address}{p.is_relay ? " (relay)" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
