import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"

interface AuditEntry {
  id: number
  action: string
  action_label: string
  details?: Record<string, unknown>
  ip_address?: string
  created_at?: string
}

function formatTime(ts?: string): string {
  if (!ts) return ""
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч. назад`
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

const ACTION_ICONS: Record<string, string> = {
  user_login: "🔑",
  user_register: "👤",
  user_logout: "🚪",
  password_changed: "🔐",
  message_sent: "💬",
  file_uploaded: "📎",
  call_started: "📞",
  call_ended: "📴",
  chat_created: "💬",
  user_blocked: "🚫",
  e2e_keys_generated: "🔒",
  backup_created: "💾",
  backup_restored: "♻️",
}

export default function AuditLogPage() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadLogs = useCallback(async () => {
    try {
      const data = await api.getAuditLogs(0, 200)
      setLogs(data.logs)
    } catch (e) {
      console.error("Failed to load audit logs:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadLogs() }, [loadLogs])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>История действий</h1>
      </div>

      <div className="settings-content">
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 16px" }}>
          Безопасность: логируются действия без содержимого сообщений
        </p>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Загрузка...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
            <p>Нет записей</p>
          </div>
        ) : (
          <div className="settings-fields">
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>
                  {ACTION_ICONS[log.action] || "📋"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {log.action_label}
                  </div>
                  {log.ip_address && (
                    <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                      IP: {log.ip_address}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "#888", flexShrink: 0 }}>
                  {formatTime(log.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
