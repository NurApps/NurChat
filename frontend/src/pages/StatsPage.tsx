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

  const typeIcons: Record<string, string> = {
    text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    audio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    voice: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  }

  const typeLabels: Record<string, string> = {
    text: "Текст", image: "Фото", video: "Видео", audio: "Аудио", voice: "Голос", file: "Файлы",
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
                <span dangerouslySetInnerHTML={{ __html: typeIcons[type] || '' }} />
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
