import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { generateInviteLink, parseInviteLink, connectToPeer, getPeerCount, initP2P, getLocalIP, startLANDiscovery, isBrowserMode } from "../services/p2pService"
import { saveKnownPeer } from "../services/p2pBridge"
import { loadKeys } from "../services/e2e"
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
        const keys = await loadKeys()
        await connectionManager.connect(parsed.publicKey, parsed.ip, parsed.port)
      } else {
        await connectToPeer(parsed.ip, parsed.port, parsed.publicKey)
      }
      saveKnownPeer(`peer_${parsed.publicKey.slice(0, 8)}`, parsed.ip, parsed.port, parsed.publicKey)
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
