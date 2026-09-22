import { useEffect, useState, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { BASE_URL, setRelayConfig, PUBLIC_RELAYS } from "../config"

interface Props {
  onReady: () => void
}

export default function ServerBootOverlay({ onReady }: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<"checking" | "ready" | "failed" | "setup">("checking")
  const [dots, setDots] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")

  // Relay setup state
  const [relayHost, setRelayHost] = useState("")
  const [relayProtocol, setRelayProtocol] = useState<"http" | "https">("https")
  // URL actually being probed right now — shown on the "checking" screen.
  // Separate from BASE_URL (frozen at module load) so a manual/custom
  // connect attempt displays its own target instead of the stale default.
  const [attemptUrl, setAttemptUrl] = useState(BASE_URL)
  // Guards the background poll below from clobbering a manual attempt's
  // phase/errorMsg with a stale BASE_URL result while it's in flight.
  const manualAttemptRef = useRef(false)

  const checkHealth = useCallback(async (url?: string): Promise<boolean> => {
    const target = url || BASE_URL
    setAttemptUrl(target)
    try {
      const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        setPhase("ready")
        return true
      } else {
        setPhase("failed")
        setErrorMsg(t("errors.relayResponded", { status: res.status }))
        return false
      }
    } catch (err) {
      setPhase("failed")
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      setErrorMsg(t("serverBoot.connectFailed", { detail }))
      return false
    }
  }, [t])

  // Poll relay health until reachable. Skipped while a manual/custom
  // connect attempt is in flight, so it can't overwrite that attempt's
  // phase/errorMsg with a stale result for the old default host.
  useEffect(() => {
    checkHealth().then((ok) => { if (ok) onReady() })
    const interval = setInterval(() => {
      if (manualAttemptRef.current) return
      checkHealth().then((ok) => { if (ok) onReady() })
    }, 5000)
    return () => clearInterval(interval)
  }, [checkHealth, onReady])

  // Animate dots
  useEffect(() => {
    if (phase !== "checking") return
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."))
    }, 500)
    return () => clearInterval(id)
  }, [phase])

  // Elapsed timer
  useEffect(() => {
    if (phase === "ready") return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  if (phase === "ready") return null

  const handleRetry = () => {
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    checkHealth().then((ok) => { if (ok) onReady() })
  }

  // NOTE: BASE_URL/WS_BASE are frozen at module load, so after switching
  // relay we must reload — otherwise api.* keeps hitting the old host.
  const handleTryPublic = async (host: string, protocol: "http" | "https") => {
    manualAttemptRef.current = true
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    setRelayConfig({ host, protocol })
    const ok = await checkHealth(`${protocol}://${host}`)
    manualAttemptRef.current = false
    if (ok) window.location.reload()
  }

  const handleTryCustom = async () => {
    if (!relayHost.trim()) return
    manualAttemptRef.current = true
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    const host = relayHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
    setRelayConfig({ host, protocol: relayProtocol })
    const ok = await checkHealth(`${relayProtocol}://${host}`)
    manualAttemptRef.current = false
    if (ok) window.location.reload()
  }

  const handleStartLocal = () => {
    setPhase("setup")
  }

  return (
    <div className="server-boot-overlay">
      <div className="server-boot-side">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.36 5.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        <p className="server-boot-side-text">
          {phase === "checking" ? t("serverBoot.connecting") : t("serverBoot.noServer")}
        </p>
      </div>
      <div className="server-boot-main">
      <div className={`server-boot-card${phase === "failed" ? " server-boot-card-wide" : ""}`}>
        {phase === "checking" && (
          <>
            <div className="spinner" />
            <h2>{t("serverBoot.connectingToRelay", { dots })}</h2>
            <p>{t("serverBoot.pleaseWait", { elapsed })}</p>
            <p className="server-boot-hint">
              <code>{attemptUrl}</code>
            </p>
          </>
        )}

        {phase === "failed" && (
          <>
            <div className="server-boot-icon error" style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
            <h2 style={{ marginBottom: 8 }}>{t("serverBoot.relayUnavailable")}</h2>
            <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 4, fontFamily: "monospace", wordBreak: "break-word" }}>
              {errorMsg}
            </p>
            <p style={{ opacity: 0.5, fontSize: 11, marginBottom: 16 }}>
              {t("serverBoot.corsHint")}
            </p>

            <div className="server-boot-options">
              {/* Try public relays */}
              {PUBLIC_RELAYS.length > 0 && (
                <div className="server-boot-option server-boot-option-wide">
                  <p className="server-boot-option-label">{t("serverBoot.publicRelay")}</p>
                  {PUBLIC_RELAYS.map((r) => (
                    <button
                      key={r.host}
                      onClick={() => handleTryPublic(r.host, r.protocol)}
                      className="settings-action-btn"
                      style={{ width: "100%", marginBottom: 6, textAlign: "left" }}
                    >
                      {r.protocol}://{r.host}
                    </button>
                  ))}
                </div>
              )}

              {/* Connect to friend's relay */}
              <div className="server-boot-option">
                <p className="server-boot-option-label">{t("serverBoot.friendsRelay")}</p>
                <p className="server-boot-option-desc">
                  {t("serverBoot.friendsRelayDesc")}
                </p>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <select
                    value={relayProtocol}
                    onChange={(e) => setRelayProtocol(e.target.value as "http" | "https")}
                    style={{
                      padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)",
                      background: "var(--card-bg)", color: "var(--text)", fontSize: 13,
                    }}
                  >
                    <option value="https">https</option>
                    <option value="http">http</option>
                  </select>
                  <input
                    className="settings-input"
                    placeholder="relay.example.com:8000"
                    value={relayHost}
                    onChange={(e) => setRelayHost(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleTryCustom()}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                </div>
                <button
                  className="settings-save-btn"
                  onClick={handleTryCustom}
                  disabled={!relayHost.trim()}
                  style={{ width: "100%", fontSize: 13 }}
                >
                  {t("serverBoot.connect")}
                </button>
              </div>

              {/* Start local server */}
              <div className="server-boot-option">
                <p className="server-boot-option-label">{t("serverBoot.ownServer")}</p>
                <p className="server-boot-option-desc">
                  {t("serverBoot.ownServerDesc")}
                </p>
                <button
                  className="settings-action-btn"
                  onClick={handleStartLocal}
                  style={{ width: "100%", fontSize: 13 }}
                >
                  {t("serverBoot.setupGuide")}
                </button>
              </div>
            </div>

            <button
              onClick={handleRetry}
              style={{
                marginTop: 16, background: "none", border: "none",
                color: "var(--accent)", cursor: "pointer", fontSize: 13,
              }}
            >
              {t("serverBoot.retry")}
            </button>
          </>
        )}

        {phase === "setup" && (
          <>
            <h2 style={{ marginBottom: 12 }}>{t("serverBoot.setupTitle")}</h2>
            <div style={{ fontSize: 13, lineHeight: 1.7, textAlign: "left", opacity: 0.85 }}>
              <p style={{ marginBottom: 12 }}>{t("serverBoot.setupDocker")}</p>
              <pre style={{
                background: "var(--input-bg)", padding: 12, borderRadius: 8,
                fontSize: 12, overflow: "auto", border: "1px solid var(--border)",
              }}>
{`# 1. Clone the repo
git clone https://github.com/NurApps/NurChat
cd NurChat

# 2. Copy env file
cp .env.example .env

# 3. Start with Docker
docker-compose up -d

# 4. Your relay is now at:
# http://YOUR_IP:8000`}
              </pre>
              <p style={{ marginTop: 12, opacity: 0.6 }}>
                {t("serverBoot.setupThen")}
              </p>
            </div>
            <button
              onClick={() => setPhase("failed")}
              style={{
                marginTop: 16, background: "none", border: "none",
                color: "var(--accent)", cursor: "pointer", fontSize: 13,
              }}
            >
              {t("serverBoot.back")}
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
