import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"

interface Stats {
  total_messages: number
  total_chats: number
  total_files: number
  messages_by_day: { date: string; count: number }[]
  top_contacts: { user_id?: string; username?: string; first_name?: string; user?: { id: string; username: string; first_name: string }; message_count: number }[]
  message_types: Record<string, number>
}

export default function StatsPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="stats-page"><div className="auth-loading"><div className="spinner" /></div></div>
  if (!stats) return <div className="stats-page"><p className="stats-empty">Не удалось загрузить статистику</p></div>

  const maxDay = Math.max(...stats.messages_by_day.map(d => d.count), 1)

  const typeLabels: Record<string, string> = {
    text: "Текст", image: "Фото", video: "Видео", audio: "Аудио", voice: "Голос", file: "Файлы",
  }

  const typeEmoji: Record<string, string> = {
    text: "\u{1F4DD}", image: "\u{1F5BC}", video: "\u{1F3AC}", audio: "\u{1F3B5}", voice: "\u{1F3A4}", file: "\u{1F4C1}",
  }

  return (
    <div className="stats-page">
      <div className="stats-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>Статистика</h1>
      </div>

      <div className="stats-cards">
        <div className="stats-card">
          <span className="stats-card-value">{stats.total_messages.toLocaleString()}</span>
          <span className="stats-card-label">Сообщений</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-value">{stats.total_chats}</span>
          <span className="stats-card-label">Чатов</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-value">{stats.total_files}</span>
          <span className="stats-card-label">Файлов</span>
        </div>
      </div>

      {stats.messages_by_day.length > 0 && (
        <div className="stats-section">
          <h2>Активность (30 дней)</h2>
          <div className="stats-chart">
            {stats.messages_by_day.map((day) => (
              <div key={day.date} className="stats-bar-wrapper" title={`${day.date}: ${day.count}`}>
                <div className="stats-bar" style={{ height: `${(day.count / maxDay) * 100}%` }} />
                <span className="stats-bar-label">{new Date(day.date).getDate()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.top_contacts.length > 0 && (
        <div className="stats-section">
          <h2>Топ контактов</h2>
          <div className="stats-contacts">
            {stats.top_contacts.map((c, i) => (
              <div key={c.user_id} className="stats-contact">
                <span className="stats-rank">#{i + 1}</span>
                <span className="stats-contact-name">{c.first_name || c.user?.first_name || c.username || c.user?.username || "User"}</span>
                <span className="stats-contact-count">{c.message_count} сообщ.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(stats.message_types).length > 0 && (
        <div className="stats-section">
          <h2>Типы сообщений</h2>
          <div className="stats-types">
            {Object.entries(stats.message_types).map(([type, count]) => (
              <div key={type} className="stats-type">
                <span>{typeEmoji[type] || "\u{1F4C4}"}</span>
                <span>{typeLabels[type] || type}</span>
                <span className="stats-type-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
