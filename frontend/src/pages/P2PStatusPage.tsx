import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import {
  initP2PBridge,
  onP2PBridgeEvent,
  getConnectedUserIds,
  isPeerConnected,
} from "../services/p2pBridge"
import P2PShare from "../components/P2PShare"

interface P2PKeys {
  private_key: string
  public_key: string
  signing_private_key: string
  signing_public_key: string
}

interface P2PPeer {
  user_id: string
  username: string
  peer_id: string
  public_key: string
  signing_public_key?: string
  is_online: boolean
}

export default function P2PStatusPage() {
  const navigate = useNavigate()
  const [keys, setKeys] = useState<P2PKeys | null>(null)
  const [hasKeys, setHasKeys] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [peers, setPeers] = useState<P2PPeer[]>([])
  const [peerQuery, setPeerQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [connectedCount, setConnectedCount] = useState(0)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    const stored = localStorage.getItem("p2p_keys")
    if (stored) {
      try {
        setKeys(JSON.parse(stored))
        setHasKeys(true)
      } catch { /* ignore */ }
    }

    // Init TCP node if keys exist
    if (stored) {
      initP2PBridge()
    }

    const unsub = onP2PBridgeEvent((event) => {
      if (event.type === "peer_connected" || event.type === "peer_disconnected") {
        setConnectedCount(getConnectedUserIds().length)
      }
    })

    return unsub
  }, [])

  const handleGenerateKeys = useCallback(async () => {
    setGenerating(true)
    setMsg("")
    try {
      const result = await api.generateP2PKeys()
      const keysData: P2PKeys = {
        private_key: result.private_key,
        public_key: result.public_key,
        signing_private_key: result.signing_private_key,
        signing_public_key: result.signing_public_key,
      }
      localStorage.setItem("p2p_keys", JSON.stringify(keysData))
      setKeys(keysData)
      setHasKeys(true)
      setMsg("P2P ключи сгенерированы и сохранены")

      // Start TCP node with new keys
      initP2PBridge()
    } catch (e: any) {
      setMsg(e.message || "Ошибка генерации ключей")
    } finally {
      setGenerating(false)
    }
  }, [])

  const handleSearchPeers = useCallback(async () => {
    if (peerQuery.trim().length < 2) return
    setSearching(true)
    try {
      const results = await api.searchP2PPeers(peerQuery.trim())
      setPeers(results as P2PPeer[])
    } catch (e: any) {
      console.error("Peer search failed:", e)
      setPeers([])
    }
    setSearching(false)
  }, [peerQuery])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>P2P</h2>
      </div>

      <div className="settings-body">
        {/* Connection Status */}
        <div className="settings-fields">
          <h3 style={{ marginTop: 0 }}>Статус</h3>
          <div className="profile-field">
            <span className="profile-field-label">TCP P2P нода</span>
            <span className="profile-field-value" style={{ color: hasKeys ? "#4CAF50" : "#ff9800" }}>
              {hasKeys ? "Активна" : "Не настроена"}
            </span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">P2P ключи</span>
            <span className="profile-field-value" style={{ color: hasKeys ? "#4CAF50" : "#ff9800" }}>
              {hasKeys ? "Настроены" : "Не сгенерированы"}
            </span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">Подключённых пиров</span>
            <span className="profile-field-value">{connectedCount}</span>
          </div>
        </div>

        {/* P2P Sharing (invite links, QR) */}
        <div className="settings-fields" style={{ marginTop: 16 }}>
          <P2PShare />
        </div>

        {/* P2P Actions */}
        <div className="settings-fields" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Управление</h3>
          {!hasKeys ? (
            <button className="settings-save-btn" onClick={handleGenerateKeys} disabled={generating}>
              {generating ? "Генерация..." : "Сгенерировать P2P ключи"}
            </button>
          ) : (
            <button className="settings-save-btn" onClick={handleGenerateKeys} disabled={generating}>
              {generating ? "Генерация..." : "Перегенерировать ключи"}
            </button>
          )}
        </div>

        {/* Keys Display */}
        {hasKeys && keys && (
          <div className="settings-fields" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Ключи</h3>
            <div className="profile-field">
              <span className="profile-field-label">Публичный ключ</span>
              <span className="profile-field-value" style={{ fontSize: 10, wordBreak: "break-all" }}>
                {keys.public_key.slice(0, 32)}...
              </span>
            </div>
            <div className="profile-field">
              <span className="profile-field-label">Signing ключ</span>
              <span className="profile-field-value" style={{ fontSize: 10, wordBreak: "break-all" }}>
                {keys.signing_public_key.slice(0, 32)}...
              </span>
            </div>
            <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
              Приватные ключи хранятся локально в localStorage. Не удаляйте их!
            </p>
          </div>
        )}

        {/* Peer Search */}
        {hasKeys && (
          <div className="settings-fields" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Поиск пиров</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="settings-input"
                placeholder="Имя пользователя..."
                value={peerQuery}
                onChange={(e) => setPeerQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchPeers()}
              />
              <button className="avatar-btn" onClick={handleSearchPeers} disabled={searching}>
                {searching ? "..." : "Найти"}
              </button>
            </div>
            {peers.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {peers.map((peer) => (
                  <div key={peer.user_id} className="profile-field">
                    <span className="profile-field-label">@{peer.username}</span>
                    <span className="profile-field-value" style={{ color: isPeerConnected(peer.user_id) ? "#4CAF50" : "#999" }}>
                      {isPeerConnected(peer.user_id) ? "P2P" : peer.is_online ? "онлайн" : "офлайн"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {msg && <p className={`settings-msg ${msg.includes("ошиб") || msg.includes("Ошибка") ? "err" : "ok"}`}>{msg}</p>}
      </div>
    </div>
  )
}
