import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { getAvatarColor } from "../utils/avatar"

interface BlockedUser {
  id: number
  user_id: string
  blocked_user_id: string
  created_at: string
  blocked_user?: { id: string; username: string; first_name: string }
}

export default function BlockedUsersPage() {
  const navigate = useNavigate()
  const [blocked, setBlocked] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState("")

  const loadBlocked = useCallback(async () => {
    try {
      const data = await api.getBlockedUsers()
      setBlocked(data)
    } catch (e) {
      console.error("Failed to load blocked users:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBlocked() }, [loadBlocked])

  const handleUnblock = useCallback(async (userId: string) => {
    try {
      await api.unblockUser(userId)
      setBlocked((prev) => prev.filter((b) => b.blocked_user_id !== userId))
      setMsg("Пользователь разблокирован")
    } catch (e) {
      setMsg("Ошибка разблокировки")
    }
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/settings")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>Заблокированные</h1>
      </div>

      <div className="settings-content">
        {msg && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(76,175,80,0.1)",
            color: "#4CAF50",
            fontSize: 13,
            marginBottom: 16,
          }}>
            {msg}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Загрузка...</div>
        ) : blocked.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <p>Нет заблокированных пользователей</p>
          </div>
        ) : (
          <div className="settings-fields">
            {blocked.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: getAvatarColor(entry.blocked_user_id),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#fff",
                  }}>
                    ?
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      @{entry.blocked_user_id.slice(0, 8)}...
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Заблокирован {new Date(entry.created_at).toLocaleDateString("ru-RU")}
                    </div>
                  </div>
                </div>
                <button
                  className="avatar-btn"
                  onClick={() => handleUnblock(entry.blocked_user_id)}
                  style={{ fontSize: 12, padding: "4px 8px", background: "var(--tg-blue)", color: "#fff" }}
                >
                  Разблокировать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
