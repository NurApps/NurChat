import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import type { UserResponse } from "../types"
import { getAvatarColor } from "../utils/avatar"

interface CallLog {
  id: number
  call_id: string
  caller_id: string
  callee_id: string
  call_type: string
  started_at: string
  ended_at?: string
  duration?: number
  ended_by?: string
  caller?: { id: string; username: string; first_name: string }
  callee?: { id: string; username: string; first_name: string }
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatCallTime(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  }
  if (diff < 604800000) {
    return d.toLocaleDateString("ru-RU", { weekday: "short", hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

export default function CallHistoryPage() {
  const navigate = useNavigate()
  const [calls, setCalls] = useState<CallLog[]>([])
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user")
      if (raw) setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getCallHistory(0, 100)
      setCalls(data.calls)
    } catch (e) {
      console.error("Failed to load call history:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const getOtherUser = (call: CallLog) => {
    if (call.caller_id === currentUser?.id) return call.callee
    return call.caller
  }

  const getCallStatus = (type: string, duration?: number) => {
    if (!duration || duration === 0) return { color: "#f44336", label: "Пропущенный" }
    if (type === "video") return { color: "#4CAF50", label: formatDuration(duration) }
    return { color: "#4CAF50", label: formatDuration(duration) }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate("/chat")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1>История звонков</h1>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>История звонков</h1>
      </div>

      <div className="settings-content">
        {calls.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <p>Нет звонков</p>
          </div>
        ) : (
          <div className="settings-fields">
            {calls.map((call) => {
              const other = getOtherUser(call)
              const status = getCallStatus(call.call_type, call.duration)
              const wasOutgoing = call.caller_id === currentUser?.id
              const name = other ? [other.first_name, other.username].filter(Boolean).join(" (@") + (other.username ? ")" : "") : "Неизвестный"

              return (
                <div
                  key={call.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    if (other) navigate(`/call/${other.id}/audio`)
                  }}
                >
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: other ? getAvatarColor(other.id) : "#666",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#fff",
                    flexShrink: 0,
                  }}>
                    {other?.first_name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 12, color: "#888", flexShrink: 0 }}>
                        {formatCallTime(call.started_at)}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: status.color, display: "flex", alignItems: "center", gap: 4 }}>
                        {wasOutgoing ? "↑" : "↓"} {status.label}
                      </span>
                      <span style={{ fontSize: 11, color: "#666" }}>
                        {call.call_type === "video" ? "Видео" : "Аудио"}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
