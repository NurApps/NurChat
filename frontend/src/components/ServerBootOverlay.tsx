import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { BASE_URL } from "../config"

interface Props {
  onReady: () => void
}

export default function ServerBootOverlay({ onReady }: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<"checking" | "ready" | "failed">("checking")
  const [dots, setDots] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        setPhase("ready")
        onReady()
      } else {
        setPhase("failed")
        setErrorMsg(t("errors.relayResponded", { status: res.status }))
      }
    } catch {
      setPhase("failed")
      setErrorMsg(t("errors.relayUnavailable"))
    }
  }, [onReady])

  // Poll relay health until reachable
  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 3000)
    return () => clearInterval(interval)
  }, [checkHealth])

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
    checkHealth()
  }

  return (
    <div className="server-boot-overlay">
      <div className="server-boot-card">
        {phase === "failed" ? (
          <>
            <div className="server-boot-icon error">✕</div>
            <h2>{t("serverBoot.relayUnavailable")}</h2>
            <p className="server-boot-error">{errorMsg}</p>
            <p className="server-boot-hint">
              {t("serverBoot.connectingTo")} <code>{BASE_URL}</code>
            </p>
            <div className="server-boot-actions">
              <button onClick={handleRetry}>{t("common.retry")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <h2>{t("serverBoot.connectingToRelay", { dots })}</h2>
            <p>{t("serverBoot.pleaseWait", { elapsed })}</p>
            <p className="server-boot-hint">
              Relay: <code>{BASE_URL}</code>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
