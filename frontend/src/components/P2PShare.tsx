import { useState, useEffect, useCallback } from "react"
import { api } from "../services/api"
import { WS_BASE } from "../config"
import styles from "./P2PShare.module.css"

interface RemotePeer {
  node_id: string
  address: string
  user_id: string
  connected_at: string
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
  const [inviteUri, setInviteUri] = useState("")
  const [portOpen, setPortOpen] = useState(false)
  const [remoteInput, setRemoteInput] = useState("")
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([])
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

  useEffect(() => { loadAddress(); loadPeers() }, [loadAddress, loadPeers])

  const handleOpenPort = async () => {
    setStatus("Открытие порта...")
    setError("")
    try {
      const data = await api.openP2PPort()
      setInviteUri(data.uri)
      setPortOpen(true)
      setStatus("Порт открыт!")
    } catch (e: any) {
      setError(e.message || "Не удалось открыть порт")
      setStatus("")
    }
  }

  const handleConnectRemote = async () => {
    if (!remoteInput.trim()) return
    setStatus("Подключение...")
    setError("")
    try {
      await api.connectToRemote(remoteInput.trim())
      setRemoteInput("")
      setStatus("Подключено!")
      loadPeers()
    } catch (e: any) {
      setError(e.message || "Не удалось подключиться")
      setStatus("")
    }
  }

  const handleLanScan = async () => {
    setLanScanning(true)
    setError("")
    try {
      const data = await api.discoverLAN()
      setLanPeers(data.peers || [])
      if (!data.peers || data.peers.length === 0) {
        setStatus("Ничего не найдено в локальной сети")
      } else {
        setStatus(`Найдено пиров: ${data.peers.length}`)
      }
    } catch (e: any) {
      setError(e.message || "Ошибка сканирования сети")
    } finally {
      setLanScanning(false)
    }
  }

  const handleConnectLan = (peer: LanPeerInfo) => {
    const uri = `nurchat://${peer.host}:${peer.port}/${peer.user_id || peer.node_id}`
    setRemoteInput(uri)
  }

  const openPort = () => {
    setStatus("Открытие порта...")
    setError("")
    handleOpenPort()
  }

  return (
    <div className={styles.container}>
      <h3>P2P соединение</h3>

      <div className={styles.section}>
        {!portOpen ? (
          <button className={styles.openBtn} onClick={openPort} disabled={status === "Открытие порта..."}>
            {status === "Открытие порта..." ? "⏳" : "🔓"} Открыть порт
          </button>
        ) : (
          <div className={styles.uriBox}>
            <label>Ваша инвайт-ссылка:</label>
            <div className={styles.uri}>{inviteUri}</div>
            <button className={styles.copyBtn} onClick={() => { navigator.clipboard.writeText(inviteUri); setStatus("Скопировано!") }}>
              📋 Копировать
            </button>
            <p className={styles.hint}>Отправьте эту ссылку другу в любом мессенджере</p>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <label>Подключиться к другу:</label>
        <div className={styles.connectRow}>
          <input
            type="text"
            placeholder="nurchat://ip:port/user_id#hash"
            value={remoteInput}
            onChange={(e) => setRemoteInput(e.target.value)}
            className={styles.input}
          />
          <button className={styles.connectBtn} onClick={handleConnectRemote} disabled={!remoteInput.trim()}>
            🔗 Подключиться
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <label>Локальная сеть (LAN):</label>
        <button className={styles.scanBtn} onClick={handleLanScan} disabled={lanScanning}>
          {lanScanning ? "⏳ Сканирование..." : "📡 Найти в локальной сети"}
        </button>
        {lanPeers.length > 0 && (
          <ul className={styles.peerList}>
            {lanPeers.map((p) => (
              <li key={p.node_id} className={styles.peerItem}>
                <span>💻 {p.peer_name}</span>
                <span className={styles.peerAddr}>{p.host}:{p.port}</span>
                <button className={styles.smallBtn} onClick={() => handleConnectLan(p)}>
                  Подключиться
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
          <h4>Подключенные пиры ({remotePeers.length})</h4>
          <ul className={styles.peerList}>
            {remotePeers.map((p) => (
              <li key={p.node_id} className={styles.peerItem}>
                <span>🟢 {p.user_id}</span>
                <span className={styles.peerAddr}>{p.address}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
