import { useEffect, useState, useCallback } from "react"
import { BASE_URL } from "../config"

interface Props {
  onReady: () => void
}

export default function ServerBootOverlay({ onReady }: Props) {
  const [status, setStatus] = useState<"checking" | "starting" | "ready" | "failed">("checking")
  const [dots, setDots] = useState("")

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        setStatus("ready")
        onReady()
      } else {
        setStatus("starting")
      }
    } catch {
      setStatus("starting")
    }
  }, [onReady])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 2000)
    return () => clearInterval(interval)
  }, [checkHealth])

  useEffect(() => {
    if (status !== "starting") return
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."))
    }, 500)
    return () => clearInterval(id)
  }, [status])

  if (status === "ready") return null

  return (
    <div className="server-boot-overlay">
      <div className="server-boot-card">
        <div className="spinner" />
        <h2>Запуск сервера{dots}</h2>
        <p>Пожалуйста, подождите</p>
      </div>
    </div>
  )
}
