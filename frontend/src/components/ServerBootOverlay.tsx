import { useEffect, useState, useCallback } from "react"
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

  const checkHealth = useCallback(async (url?: string): Promise<boolean> => {
    const target = url || BASE_URL
    try {
      const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        setPhase("ready")
        return true
      } else {
        setPhase("failed")
        setErrorMsg(`Relay responded with status ${res.status}`)
        return false
      }
    } catch {
      setPhase("failed")
      setErrorMsg("Could not connect to relay server")
      return false
    }
  }, [])

  // Poll relay health until reachable
  useEffect(() => {
    checkHealth().then((ok) => { if (ok) onReady() })
    const interval = setInterval(() => {
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
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    setRelayConfig({ host, protocol })
    const ok = await checkHealth(`${protocol}://${host}`)
    if (ok) window.location.reload()
  }

  const handleTryCustom = async () => {
    if (!relayHost.trim()) return
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    const host = relayHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
    setRelayConfig({ host, protocol: relayProtocol })
    const ok = await checkHealth(`${relayProtocol}://${host}`)
    if (ok) window.location.reload()
  }

  const handleStartLocal = () => {
    setPhase("setup")
  }

  return (
    <div className="server-boot-overlay">
      <div className="server-boot-card" style={{ maxWidth: 440 }}>
        {phase === "checking" && (
          <>
            <div className="spinner" />
            <h2>Connecting to relay{dots}</h2>
            <p>Waiting {elapsed}s...</p>
            <p className="server-boot-hint">
              <code>{BASE_URL}</code>
            </p>
          </>
        )}

        {phase === "failed" && (
          <>
            <div className="server-boot-icon error" style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
            <h2 style={{ marginBottom: 8 }}>Relay unavailable</h2>
            <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 16 }}>
              {errorMsg}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
              {/* Try public relays */}
              {PUBLIC_RELAYS.length > 0 && (
                <div style={{ padding: 12, borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7 }}>PUBLIC RELAY</p>
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
              <div style={{ padding: 12, borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7 }}>FRIEND'S RELAY</p>
                <p style={{ fontSize: 12, marginBottom: 8, opacity: 0.6 }}>
                  Ask your friend for their relay address
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
                  Connect
                </button>
              </div>

              {/* Start local server */}
              <div style={{ padding: 12, borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7 }}>YOUR OWN SERVER</p>
                <p style={{ fontSize: 12, marginBottom: 8, opacity: 0.6 }}>
                  Run your own relay for full control
                </p>
                <button
                  className="settings-action-btn"
                  onClick={handleStartLocal}
                  style={{ width: "100%", fontSize: 13 }}
                >
                  Setup guide
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
              Retry connection
            </button>
          </>
        )}

        {phase === "setup" && (
          <>
            <h2 style={{ marginBottom: 12 }}>Setup your own relay</h2>
            <div style={{ fontSize: 13, lineHeight: 1.7, textAlign: "left", opacity: 0.85 }}>
              <p style={{ marginBottom: 12 }}>Quick start with Docker:</p>
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
                Then enter your relay address above.
              </p>
            </div>
            <button
              onClick={() => setPhase("failed")}
              style={{
                marginTop: 16, background: "none", border: "none",
                color: "var(--accent)", cursor: "pointer", fontSize: 13,
              }}
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}
