import { useState, useEffect } from "react"
import { generateInviteLink, parseInviteLink, connectToPeer, getPeerCount, initP2P, getLocalIP, startLANDiscovery } from "../services/p2pService"
import { saveKnownPeer } from "../services/p2pBridge"
import { loadKeys } from "../services/e2e"
import QRCode from "../components/QRCode"

export default function P2PPage() {
  const [inviteLink, setInviteLink] = useState("")
  const [scanInput, setScanInput] = useState("")
  const [peerCount, setPeerCount] = useState(0)
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [copied, setCopied] = useState(false)
  const [connectedPeer, setConnectedPeer] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const port = await initP2P()
      const ip = await getLocalIP()
      const keys = await loadKeys()
      if (keys && port) {
        setInviteLink(generateInviteLink(keys.publicKeyHex, port, ip))
      }
    }
    init()

    const interval = setInterval(() => {
      getPeerCount().then(setPeerCount).catch(() => {})
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleConnect = async () => {
    if (!scanInput.trim()) return
    setStatus("connecting")
    setErrorMsg("")

    const parsed = parseInviteLink(scanInput.trim())
    if (!parsed) {
      setStatus("error")
      setErrorMsg("Неверный формат ссылки. Используйте: nurchat://IP:PORT#PUBKEY")
      return
    }

    try {
      await connectToPeer(parsed.ip, parsed.port, parsed.publicKey)
      saveKnownPeer(`peer_${parsed.publicKey.slice(0, 8)}`, parsed.ip, parsed.port, parsed.publicKey)
      setStatus("connected")
      setConnectedPeer(parsed.publicKey.slice(0, 8) + "...")
      setScanInput("")
    } catch (err) {
      setStatus("error")
      setErrorMsg("Не удалось подключиться. Проверьте IP и порт.")
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
      const el = document.createElement("textarea")
      el.value = inviteLink
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Приглашение в NurChat",
          text: "Присоединяйся ко мне в NurChat! Перейди по ссылке:",
          url: inviteLink,
        })
      } catch {}
    } else {
      handleCopy()
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 8 }}>P2P Подключение</h2>
      <p style={{ fontSize: 13, color: "#8b949e", marginBottom: 24 }}>
        Прямое соединение между устройствами без сервера
      </p>

      {/* Status */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 24,
        background: status === "connected" ? "#1a472a" : status === "error" ? "#4a1c1c" : "#1a1a2e",
        border: `1px solid ${status === "connected" ? "#2d6a4f" : status === "error" ? "#6b2b2b" : "#333"}`,
      }}>
        <div style={{ fontSize: 14, color: "#aaa", display: "flex", justifyContent: "space-between" }}>
          <span>
            Статус: <span style={{ color: status === "connected" ? "#4ade80" : status === "error" ? "#f87171" : "#fbbf24" }}>
              {status === "connected" ? `Подключён к ${connectedPeer}` : status === "connecting" ? "Подключение..." : status === "error" ? "Ошибка" : "Ожидание"}
            </span>
          </span>
          <span>Пиров: {peerCount}</span>
        </div>
      </div>

      {/* Invite Section */}
      <div style={{
        padding: 16, background: "#161b22", borderRadius: 8,
        border: "1px solid #30363d", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Пригласить друга</h3>
        
        {inviteLink && (
          <>
            {/* QR + Link side by side */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
              <QRCode data={inviteLink} size={140} />
              <div style={{ flex: 1 }}>
                <div style={{
                  padding: 12, background: "#0d1117", borderRadius: 8,
                  fontFamily: "monospace", fontSize: 12, wordBreak: "break-all",
                  border: "1px solid #333", color: "#c9d1d9", marginBottom: 8,
                }}>
                  {inviteLink}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  Друг может отсканировать QR или вставить ссылку вручную
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleCopy}
                style={{
                  flex: 1, padding: "10px 16px", background: copied ? "#238636" : "#21262d", color: "#fff",
                  border: "1px solid #30363d", borderRadius: 6, cursor: "pointer",
                  fontSize: 14, fontWeight: 500, minWidth: 120,
                }}
              >
                {copied ? "✓ Скопировано" : "Копировать ссылку"}
              </button>
              
              <button
                onClick={handleShare}
                style={{
                  flex: 1, padding: "10px 16px", background: "#1f6feb", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  fontSize: 14, fontWeight: 500, minWidth: 120,
                }}
              >
                Отправить
              </button>
            </div>

            <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
              Скопируйте ссылку и отправьте другу любым удобным способом (Telegram, WhatsApp, SMS)
            </p>
          </>
        )}
      </div>

      {/* Connect to Peer Section */}
      <div style={{
        padding: 16, background: "#161b22", borderRadius: 8,
        border: "1px solid #30363d", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Подключиться к другу</h3>
        
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="Вставьте ссылку друга"
            style={{
              flex: 1, padding: "10px 12px", background: "#0d1117",
              border: "1px solid #333", borderRadius: 6, color: "#fff",
              fontSize: 14,
            }}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
          <button
            onClick={handleConnect}
            disabled={!scanInput.trim() || status === "connecting"}
            style={{
              padding: "10px 20px", background: "#238636", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer",
              opacity: !scanInput.trim() || status === "connecting" ? 0.5 : 1,
              fontSize: 14, fontWeight: 500,
            }}
          >
            Подключить
          </button>
        </div>
        
        {errorMsg && (
          <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>{errorMsg}</div>
        )}
        
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Получите ссылку от друга и вставьте её сюда
        </p>
      </div>

      {/* LAN Discovery */}
      <div style={{
        padding: 16, background: "#161b22", borderRadius: 8,
        border: "1px solid #30363d", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Локальная сеть</h3>
        <button
          onClick={async () => {
            try {
              await startLANDiscovery()
              setStatus("idle")
            } catch (err) {
              setStatus("error")
              setErrorMsg("Ошибка запуска LAN discovery")
            }
          }}
          style={{
            padding: "10px 16px", background: "#1f6feb", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontSize: 14, fontWeight: 500,
          }}
        >
          Найти в локальной сети
        </button>
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Автоматически найдёт пиров в той же Wi-Fi сети
        </p>
      </div>

      {/* How it works */}
      <div style={{
        padding: 16, background: "#161b22", borderRadius: 8,
        border: "1px solid #30363d",
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Как это работает</h3>
        <div style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#c9d1d9" }}>1.</strong> Каждое приложение автоматически слушает TCP порт
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#c9d1d9" }}>2.</strong> Нажмите "Копировать ссылку" и отправьте другу
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#c9d1d9" }}>3.</strong> Друг вставляет ссылку и нажимает "Подключить"
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#c9d1d9" }}>4.</strong> Соединение установлено — E2E шифрование активно
          </div>
          <div>
            <strong style={{ color: "#c9d1d9" }}>5.</strong> Если прямое соединение невозможно — третий пир ретранслирует
          </div>
        </div>
      </div>
    </div>
  )
}
