import { useEffect, useState, useCallback } from "react"
import { listen } from "@tauri-apps/api/event"
import { BASE_URL } from "../config"

interface Props {
  onReady: () => void
}

interface ServerStatus {
  status: "starting" | "ready" | "failed"
  error?: string
}

export default function ServerBootOverlay({ onReady }: Props) {
  const [phase, setPhase] = useState<"checking" | "starting" | "downloading" | "ready" | "failed">("checking")
  const [dots, setDots] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        setPhase("ready")
        onReady()
      }
    } catch {}
  }, [onReady])

  // Listen for Tauri events from Rust
  useEffect(() => {
    const unlisten = listen<ServerStatus>("server-status", (event) => {
      const s = event.payload
      if (s.status === "ready") {
        setPhase("ready")
        onReady()
      } else if (s.status === "failed") {
        setPhase("failed")
        setErrorMsg(s.error || "Неизвестная ошибка")
      } else if (s.status === "starting") {
        setPhase("starting")
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [onReady])

  // Initial health check
  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 2000)
    return () => clearInterval(interval)
  }, [checkHealth])

  // Animate dots
  useEffect(() => {
    if (phase !== "starting" && phase !== "downloading") return
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."))
    }, 500)
    return () => clearInterval(id)
  }, [phase])

  // Elapsed timer
  useEffect(() => {
    if (phase === "ready" || phase === "failed") return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Phase after 10s: show "downloading"
  useEffect(() => {
    if (phase === "starting" && elapsed >= 10) {
      setPhase("downloading")
    }
  }, [elapsed, phase])

  if (phase === "ready") return null

  const handleRetry = () => {
    setPhase("checking")
    setErrorMsg("")
    setElapsed(0)
    checkHealth()
  }

  const handleOpenLogs = () => {
    // TODO: open log file
  }

  return (
    <div className="server-boot-overlay">
      <div className="server-boot-card">
        {phase === "failed" ? (
          <>
            <div className="server-boot-icon error">✕</div>
            <h2>Сервер не запустился</h2>
            <p className="server-boot-error">{errorMsg}</p>
            <div className="server-boot-hint">
              <p>Возможные решения:</p>
              <ul>
                <li>Установите Python 3.10+ и добавьте в PATH</li>
                <li>Или положите <code>server.exe</code> рядом с приложением</li>
              </ul>
            </div>
            <div className="server-boot-actions">
              <button onClick={handleRetry}>Повторить</button>
              <button onClick={handleOpenLogs}>Открыть логи</button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <h2>
              {phase === "downloading"
                ? "Установка зависимостей"
                : "Запуск сервера"}
              {dots}
            </h2>
            <p>
              {phase === "downloading"
                ? `Скачивание Python и установка пакетов (${elapsed}с)`
                : `Пожалуйста, подождите (${elapsed}с)`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
