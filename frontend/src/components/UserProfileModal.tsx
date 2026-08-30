import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { avatarUrl } from "../config"
import type { UserResponse } from "../types"
import { formatDateShort, formatFull } from "../utils/format"
import { getAvatarColor } from "../utils/avatar"
import SafetyNumberModal from "./SafetyNumberModal"

interface Props {
  user: UserResponse
  onClose: () => void
}

function formatLastSeen(ts?: string, t?: (key: string, opts?: any) => string): string {
  if (!ts) return t ? t("userProfile.unknown") : "неизвестно"
  try {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return t ? t("userProfile.justNow") : "только что"
    if (diff < 3600000) return t ? t("userProfile.minutesAgo", { count: Math.floor(diff / 60000) }) : `${Math.floor(diff / 60000)} мин. назад`
    if (diff < 86400000) return t ? t("userProfile.hoursAgo", { count: Math.floor(diff / 3600000) }) : `${Math.floor(diff / 3600000)} ч. назад`
    return formatDateShort(ts)
  } catch {
    return ts
  }
}

export default function UserProfileModal({ user, onClose }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showSafetyNumber, setShowSafetyNumber] = useState(false)
  const name = user.first_name || user.username || "Пользователь"
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const avatarChar = name[0]?.toUpperCase() || "?"
  const avatarColor = getAvatarColor(name)
  const avatar = avatarUrl(user.avatar_path)

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Профиль пользователя" onClick={onClose}>
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
            {user.is_online ? t("common.online") : t("userProfile.wasOnline", { time: formatLastSeen(user.last_seen, t) })}
          </span>
        </div>

        <div className="upm-details">
          {user.bio && (
            <div className="upm-field">
              <span className="upm-field-label">{t("userProfile.about")}</span>
              <span className="upm-field-value">{user.bio}</span>
            </div>
          )}
          {user.status && (
            <div className="upm-field">
              <span className="upm-field-label">{t("userProfile.status")}</span>
              <span className="upm-field-value">{user.status}</span>
            </div>
          )}
          {user.created_at && (
            <div className="upm-field">
              <span className="upm-field-label">{t("userProfile.registered")}</span>
              <span className="upm-field-value">
                {formatFull(user.created_at)}
              </span>
            </div>
          )}
        </div>

        <div className="upm-actions">
          <button className="upm-action-btn" onClick={() => { onClose(); navigate(`/call/${user.id}/audio`) }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            {t("userProfile.call")}
          </button>
          <button className="upm-action-btn primary" onClick={() => { onClose(); navigate("/chat") }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {t("userProfile.write")}
          </button>
          {user.public_key && (
            <button className="upm-action-btn" onClick={() => setShowSafetyNumber(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {t("userProfile.checkKey")}
            </button>
          )}
        </div>

        {showSafetyNumber && user.public_key && (
          <SafetyNumberModal
            theirUserId={user.id}
            theirPublicKey={user.public_key}
            theirUsername={user.username || user.first_name || "пользователь"}
            onClose={() => setShowSafetyNumber(false)}
          />
        )}
      </div>
    </div>
  )
}
