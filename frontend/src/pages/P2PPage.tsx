import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { generateInviteLink, generateTunnelInviteLink, parseInviteLink, connectToPeer, getPeerCount, initP2P, getLocalIP, startLANDiscovery, isBrowserMode } from "../services/p2pService"
import { saveKnownPeer } from "../services/p2pBridge"
import { loadKeys } from "../services/e2e"
import { setRelayConfig } from "../config"
import QRCode from "../components/QRCode"
import P2POnboarding from "../components/P2POnboarding"

export default function P2PPage() {
  const { t } = useTranslation()
  const [inviteLink, setInviteLink] = useState("")
  const [scanInput, setScanInput] = useState("")
  const [peerCount, setPeerCount] = useState(0)
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [copied, setCopied] = useState(false)
  const [connectedPeer, setConnectedPeer] = useState<string | null>(null)
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null)
  const [tunnelInviteLink, setTunnelInviteLink] = useState<string | null>(null)
  const [tunnelLoading, setTunnelLoading] = useState(false)
  const [tunnelCopied, setTunnelCopied] = useState(false)
  const [tunnelInviteCopied, setTunnelInviteCopied] = useState(false)
  const browserMode = isBrowserMode()

  useEffect(() => {
    const init = async () => {
      const port = await initP2P()
      const ip = await getLocalIP()
      const keys = await loadKeys()
      if (keys && port) {
        setInviteLink(generateInviteLink(keys.publicKeyHex, port, ip))
      } else if (keys && browserMode) {
        setInviteLink(generateInviteLink(keys.publicKeyHex, 0, "browser"))
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
      setErrorMsg(t("p2p.invalidLink"))
      return
    }

    try {
      if (parsed.port === 0 || browserMode) {
        const { connectionManager } = await import("../services/p2pConnectionManager")
        await connectionManager.connect(parsed.publicKey, parsed.ip, parsed.port)
      } else {
        await connectToPeer(parsed.ip, parsed.port, parsed.publicKey)
      }
      // Persist with the REAL user_id from the invite link
      // (nurchat://ip:port/USER_ID#key) so peer->user mapping works
      // across restarts. Fall back to relay lookup by public key.
      let realUserId = parsed.userId || ""
      if (!realUserId) {
        try {
          const { api } = await import("../services/api")
          const users = await api.getAllUsers()
          realUserId = users.find((u) => (u.public_key || "").toLowerCase() === parsed.publicKey.toLowerCase())?.id || ""
        } catch { /* relay unavailable */ }
      }
      const { registerPeer } = await import("../services/p2pBridge")
      if (realUserId) registerPeer(realUserId, parsed.publicKey)
      saveKnownPeer(realUserId || `peer_${parsed.publicKey.slice(0, 8)}`, parsed.ip, parsed.port, parsed.publicKey)
      setStatus("connected")
      setConnectedPeer(parsed.publicKey.slice(0, 8) + "...")
      setScanInput("")
    } catch (err) {
      setStatus("error")
      setErrorMsg(t("p2p.connectFailed"))
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
          title: t("p2p.shareTitle"),
          text: t("p2p.shareText"),
          url: inviteLink,
        })
      } catch {}
    } else {
      handleCopy()
    }
  }

  const handleStartTunnel = async () => {
    setTunnelLoading(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const url = await invoke<string>("start_cloudflare_tunnel")
      setTunnelUrl(url)

      // Generate nurchat:// invite link with tunnel domain
      const keys = await loadKeys()
      if (keys) {
        const host = url.replace("https://", "")
        const invite = generateTunnelInviteLink(keys.publicKeyHex, host)
        setTunnelInviteLink(invite)
      }

      // Auto-configure relay
      const host = url.replace("https://", "")
      setRelayConfig({ host, protocol: "https" })

      // Reload to apply new relay
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      console.error("Tunnel error:", err)
      alert(`Ошибка: ${err}`)
    } finally {
      setTunnelLoading(false)
    }
  }

  const handleStopTunnel = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("stop_cloudflare_tunnel")
      setTunnelUrl(null)
    } catch (err) {
      console.error("Stop tunnel error:", err)
    }
  }

  const handleCopyTunnelUrl = async () => {
    if (!tunnelUrl) return
    try {
      await navigator.clipboard.writeText(tunnelUrl)
      setTunnelCopied(true)
      setTimeout(() => setTunnelCopied(false), 2000)
    } catch {}
  }

  const handleCopyTunnelInvite = async () => {
    if (!tunnelInviteLink) return
    try {
      await navigator.clipboard.writeText(tunnelInviteLink)
      setTunnelInviteCopied(true)
      setTimeout(() => setTunnelInviteCopied(false), 2000)
    } catch {}
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <P2POnboarding />
      <h2 style={{ marginBottom: 8 }}>{t("p2p.title")}</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary, #8b949e)", marginBottom: 24 }}>
        {t("p2p.subtitle")}
      </p>

      {/* Status */}
      <div style={{
        padding: 12, borderRadius: 8, marginBottom: 24,
        background: status === "connected" ? "#1a472a" : status === "error" ? "#4a1c1c" : "#1a1a2e",
        border: `1px solid ${status === "connected" ? "#2d6a4f" : status === "error" ? "#6b2b2b" : "#333"}`,
      }}>
        <div style={{ fontSize: 14, color: "var(--text-secondary, #aaa)", display: "flex", justifyContent: "space-between" }}>
          <span>
            {t("p2p.status")}: <span style={{ color: status === "connected" ? "#4ade80" : status === "error" ? "#f87171" : "#fbbf24" }}>
              {status === "connected" ? t("p2p.connectedTo", { peer: connectedPeer }) : status === "connecting" ? t("p2p.connecting") : status === "error" ? t("p2p.error") : t("p2p.waiting")}
            </span>
          </span>
          <span>{t("p2p.peers", { count: peerCount })}</span>
        </div>
      </div>

      {browserMode && (
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 16,
          background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
          fontSize: 12, color: "#fbbf24",
        }}>
          {t("p2p.browserMode", "Режим браузера: P2P-хостинг недоступен. Используйте WebRTC для подключения к пирам.")}
        </div>
      )}

      {/* Invite Section */}
      <div style={{
        padding: 16, background: "var(--surface, #161b22)", borderRadius: 8,
        border: "1px solid var(--border-color, #30363d)", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>{t("p2p.inviteFriend")}</h3>
        
        {inviteLink && (
          <>
            {/* QR + Link side by side */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
              <QRCode data={inviteLink} size={140} />
              <div style={{ flex: 1 }}>
                <div style={{
                  padding: 12, background: "var(--input-bg, var(--surface-variant, #0d1117))", borderRadius: 8,
                  fontFamily: "monospace", fontSize: 12, wordBreak: "break-all",
                  border: "1px solid var(--border-color, #333)", color: "var(--text-primary, #c9d1d9)", marginBottom: 8,
                }}>
                  {inviteLink}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary, #666)" }}>
                  {t("p2p.qrHint")}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleCopy}
                style={{
                  flex: 1, padding: "10px 16px", background: copied ? "#238636" : "#21262d", color: "#fff",
                  border: "1px solid var(--border-color, #30363d)", borderRadius: 6, cursor: "pointer",
                  fontSize: 14, fontWeight: 500, minWidth: 120,
                }}
              >
                {copied ? t("p2p.copied") : t("p2p.copyLink")}
              </button>
              
              <button
                onClick={handleShare}
                style={{
                  flex: 1, padding: "10px 16px", background: "#1f6feb", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  fontSize: 14, fontWeight: 500, minWidth: 120,
                }}
              >
                {t("p2p.send")}
              </button>
            </div>

            <p style={{ fontSize: 12, color: "var(--text-secondary, #666)", marginTop: 12 }}>
              {t("p2p.copyHint")}
            </p>
          </>
        )}
      </div>

      {/* Connect to Peer Section */}
      <div style={{
        padding: 16, background: "var(--surface, #161b22)", borderRadius: 8,
        border: "1px solid var(--border-color, #30363d)", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>{t("p2p.connectToFriend")}</h3>
        
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder={t("p2p.pasteFriendLink")}
            style={{
              flex: 1, padding: "10px 12px", background: "var(--input-bg, var(--surface-variant, #0d1117))",
              border: "1px solid var(--border-color, #333)", borderRadius: 6, color: "#fff",
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
            {t("p2p.connect")}
          </button>
        </div>
        
        {errorMsg && (
          <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>{errorMsg}</div>
        )}
        
        <p style={{ fontSize: 12, color: "var(--text-secondary, #666)", marginTop: 8 }}>
          {t("p2p.getLinkHint")}
        </p>
      </div>

      {/* LAN Discovery */}
      <div style={{
        padding: 16, background: "var(--surface, #161b22)", borderRadius: 8,
        border: "1px solid var(--border-color, #30363d)", marginBottom: 24,
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>{t("p2p.lanTitle")}</h3>
        <button
          onClick={async () => {
            try {
              await startLANDiscovery()
              setStatus("idle")
            } catch (err) {
              setStatus("error")
              setErrorMsg(t("p2p.lanError"))
            }
          }}
          style={{
            padding: "10px 16px", background: "#1f6feb", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontSize: 14, fontWeight: 500,
          }}
        >
          {t("p2p.findLan")}
        </button>
        <p style={{ fontSize: 12, color: "var(--text-secondary, #666)", marginTop: 8 }}>
          {t("p2p.lanDesc")}
        </p>
      </div>

      {/* Cloudflare Tunnel */}
      {!browserMode && (
        <div style={{
          padding: 16, background: "var(--surface, #161b22)", borderRadius: 8,
          border: "1px solid var(--border-color, #30363d)", marginBottom: 24,
        }}>
          <h3 style={{ marginBottom: 8, fontSize: 16 }}>
            {"Туннель для друга"}
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-secondary, #8b949e)", marginBottom: 12 }}>
            {"Создайт туннель чтобы друг имел доступ к твоему релею. App скачает cloudflared автоматически."}
          </p>

          {tunnelLoading ? (
            <div style={{
              padding: 12, borderRadius: 8, textAlign: "center",
              background: "rgba(31,111,235,0.1)", border: "1px solid rgba(31,111,235,0.3)",
            }}>
              <div style={{ fontSize: 14, color: "#1f6feb" }}>
                {"Запуск туннеля..."}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary, #666)", marginTop: 4 }}>
                {"Скачивание cloudflared, если первый раз"}
              </div>
            </div>
          ) : tunnelUrl ? (
            <div>
              <div style={{
                padding: 12, borderRadius: 8, marginBottom: 8,
                background: "rgba(35,134,54,0.1)", border: "1px solid rgba(35,134,54,0.3)",
              }}>
                <div style={{ fontSize: 13, color: "#4ade80", marginBottom: 8, fontWeight: 500 }}>
                  {"Туннель активен"}
                </div>

                {/* Relay URL */}
                <div style={{ fontSize: 12, color: "var(--text-secondary, #8b949e)", marginBottom: 4 }}>
                  {"URL релея (для Настройки → Транспорт):"}
                </div>
                <div style={{
                  padding: 8, borderRadius: 4,
                  background: "var(--input-bg, var(--surface-variant, #0d1117))",
                  fontFamily: "monospace", fontSize: 12, wordBreak: "break-all",
                  border: "1px solid var(--border-color, #333)", color: "var(--text-primary, #c9d1d9)",
                  marginBottom: 8,
                }}>
                  {tunnelUrl}
                </div>
                <button
                  onClick={handleCopyTunnelUrl}
                  style={{
                    width: "100%", padding: "8px 12px", marginBottom: 12,
                    background: tunnelCopied ? "#238636" : "#21262d",
                    color: "#fff", border: "1px solid var(--border-color, #30363d)",
                    borderRadius: 6, cursor: "pointer", fontSize: 13,
                  }}
                >
                  {tunnelCopied ? "Скопировано" : "Копировать URL релея"}
                </button>

                {/* Nurchat invite link */}
                {tunnelInviteLink && (
                  <>
                    <div style={{ fontSize: 12, color: "var(--text-secondary, #8b949e)", marginBottom: 4 }}>
                      {"Ссылка для подключения (nurchat://):"}
                    </div>
                    <div style={{
                      padding: 8, borderRadius: 4,
                      background: "var(--input-bg, var(--surface-variant, #0d1117))",
                      fontFamily: "monospace", fontSize: 11, wordBreak: "break-all",
                      border: "1px solid var(--border-color, #333)", color: "#fbbf24",
                      marginBottom: 8,
                    }}>
                      {tunnelInviteLink}
                    </div>
                    <button
                      onClick={handleCopyTunnelInvite}
                      style={{
                        width: "100%", padding: "8px 12px",
                        background: tunnelInviteCopied ? "#238636" : "#1f6feb",
                        color: "#fff", border: "none",
                        borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500,
                      }}
                    >
                      {tunnelInviteCopied ? "Скопировано" : "Копировать nurchat:// ссылку"}
                    </button>
                  </>
                )}

                <div style={{ fontSize: 12, color: "var(--text-secondary, #8b949e)", marginTop: 12 }}>
                  {"Отправь другу обе ссылки. Он вставит nurchat:// ссылку в P2P → Подключить."}
                </div>

                <button
                  onClick={handleStopTunnel}
                  style={{
                    width: "100%", padding: "8px 12px", marginTop: 12,
                    background: "#4a1c1c", color: "#f87171",
                    border: "1px solid #6b2b2b", borderRadius: 6, cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {"Остановить туннель"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleStartTunnel}
              style={{
                padding: "10px 16px", background: "#1f6feb", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer",
                fontSize: 14, fontWeight: 500,
              }}
            >
              {"Создать туннель"}
            </button>
          )}
        </div>
      )}

      {/* How it works */}
      <div style={{
        padding: 16, background: "var(--surface, #161b22)", borderRadius: 8,
        border: "1px solid var(--border-color, #30363d)",
      }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>{t("p2p.howItWorks")}</h3>
        <div style={{ fontSize: 13, color: "var(--text-secondary, #8b949e)", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--text-primary, #c9d1d9)" }}>1.</strong> {t("p2p.step1")}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--text-primary, #c9d1d9)" }}>2.</strong> {t("p2p.step2")}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--text-primary, #c9d1d9)" }}>3.</strong> {t("p2p.step3")}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--text-primary, #c9d1d9)" }}>4.</strong> {t("p2p.step4")}
          </div>
          <div>
            <strong style={{ color: "var(--text-primary, #c9d1d9)" }}>5.</strong> {t("p2p.step5")}
          </div>
        </div>
      </div>
    </div>
  )
}
