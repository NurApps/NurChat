import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { p2pClient } from "../services/p2p"

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
  const [p2pConnected, setP2pConnected] = useState(false)
  const [ipfsOnline, setIpfsOnline] = useState<boolean | null>(null)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    const stored = localStorage.getItem("p2p_keys")
    if (stored) {
      try {
        setKeys(JSON.parse(stored))
        setHasKeys(true)
      } catch { /* ignore */ }
    }

    setP2pConnected(p2pClient.isConnected)

    const unsub = p2pClient.on((event) => {
      if (event.type === "connected") setP2pConnected(true)
      if (event.type === "disconnected") setP2pConnected(false)
    })

    // Check IPFS status via health endpoint
    api.testConnection().then(() => setIpfsOnline(true)).catch(() => setIpfsOnline(false))

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

      // Reconnect P2P with new keys
      if (p2pClient.isConnected) {
        p2pClient.disconnect()
      }
      const token = localStorage.getItem("token")
      const user = JSON.parse(localStorage.getItem("user") || "null")
      if (user && token) {
        p2pClient.connect(user.id, token)
      }
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
      setPeers(results)
    } catch (e: any) {
      console.error("Peer search failed:", e)
      setPeers([])
    }
    setSearching(false)
  }, [peerQuery])

  const handleConnectP2P = useCallback(() => {
    const token = localStorage.getItem("token")
    const user = JSON.parse(localStorage.getItem("user") || "null")
    if (user && token) {
      p2pClient.connect(user.id, token)
      setMsg("P2P подключение...")
    }
  }, [])

  const handleDisconnectP2P = useCallback(() => {
    p2pClient.disconnect()
    setP2pConnected(false)
  }, [])

  const handleSyncPending = useCallback(async () => {
    try {
      p2pClient.requestSync()
      setMsg("Запрос синхронизации отправлен")
    } catch (e: any) {
      setMsg("Ошибка синхронизации")
    }
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>P2P & IPFS</h2>
      </div>

      <div className="settings-body">
        {/* Connection Status */}
        <div className="settings-fields">
          <h3 style={{ marginTop: 0 }}>Статус</h3>
          <div className="profile-field">
            <span className="profile-field-label">P2P соединение</span>
            <span className="profile-field-value" style={{ color: p2pConnected ? "#4CAF50" : "#f44336" }}>
              {p2pConnected ? "Подключено" : "Отключено"}
            </span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">P2P ключи</span>
            <span className="profile-field-value" style={{ color: hasKeys ? "#4CAF50" : "#ff9800" }}>
              {hasKeys ? "Настроены" : "Не сгенерированы"}
            </span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">IPFS</span>
            <span className="profile-field-value" style={{ color: ipfsOnline ? "#4CAF50" : "#9E9E9E" }}>
              {ipfsOnline === null ? "Проверка..." : ipfsOnline ? "Онлайн" : "Недоступен"}
            </span>
          </div>
        </div>

        {/* P2P Actions */}
        <div className="settings-fields" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Управление</h3>
          {!hasKeys ? (
            <button className="settings-save-btn" onClick={handleGenerateKeys} disabled={generating}>
              {generating ? "Генерация..." : "Сгенерировать P2P ключи"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!p2pConnected ? (
                <button className="settings-save-btn" onClick={handleConnectP2P}>
                  Подключить P2P
                </button>
              ) : (
                <>
                  <button className="avatar-btn" onClick={handleSyncPending}>
                    Синхронизировать
                  </button>
                  <button className="avatar-btn danger" onClick={handleDisconnectP2P}>
                    Отключить P2P
                  </button>
                </>
              )}
            </div>
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
                    <span className="profile-field-value" style={{ color: peer.is_online ? "#4CAF50" : "#999" }}>
                      {peer.is_online ? "онлайн" : "офлайн"}
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
