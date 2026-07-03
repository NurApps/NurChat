import { useNavigate } from "react-router-dom"
import { avatarUrl } from "../config"
import type { UserResponse } from "../types"

interface Props {
  user: UserResponse
  onClose: () => void
}

const AVATAR_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function formatLastSeen(ts?: string): string {
  if (!ts) return "неизвестно"
  try {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return "только что"
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч. назад`
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
  } catch {
    return ts
  }
}

export default function UserProfileModal({ user, onClose }: Props) {
  const navigate = useNavigate()
  const name = user.first_name || user.username || "Пользователь"
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const avatarChar = name[0]?.toUpperCase() || "?"
  const avatarColor = getAvatarColor(name)
  const avatar = avatarUrl(user.avatar_path)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upm-header">
          <button className="upm-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="upm-avatar-section">
          {avatar ? (
            <img src={avatar} alt={name} className="upm-avatar-img" />
          ) : (
            <div className="upm-avatar-circle" style={{ background: avatarColor }}>
              {avatarChar}
            </div>
          )}
          <h2 className="upm-name">{fullName}</h2>
          {user.username && user.username !== user.first_name && (
            <span className="upm-username">@{user.username}</span>
          )}
          <span className={`upm-status ${user.is_online ? "online" : ""}`}>
            {user.is_online ? "в сети" : `был(а) ${formatLastSeen(user.last_seen)}`}
          </span>
        </div>

        <div className="upm-details">
          {user.bio && (
            <div className="upm-field">
              <span className="upm-field-label">О себе</span>
              <span className="upm-field-value">{user.bio}</span>
            </div>
          )}
          {user.status && (
            <div className="upm-field">
              <span className="upm-field-label">Статус</span>
              <span className="upm-field-value">{user.status}</span>
            </div>
          )}
          {user.created_at && (
            <div className="upm-field">
              <span className="upm-field-label">Дата регистрации</span>
              <span className="upm-field-value">
                {new Date(user.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        <div className="upm-actions">
          <button className="upm-action-btn" onClick={() => { onClose(); navigate(`/call/${user.id}/audio`) }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Позвонить
          </button>
          <button className="upm-action-btn primary" onClick={() => { onClose(); navigate("/chat") }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Написать
          </button>
        </div>
      </div>
    </div>
  )
}
