import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { avatarUrl } from "../config"
import type { UserResponse } from "../types"
import { formatDateShort, formatFull } from "../utils/format"
import { getAvatarColor } from "../utils/avatar"
import SafetyNumberModal from "./SafetyNumberModal"
import { LockKeyhole, MessageCircle, Phone, X } from "lucide-react"

interface Props {
  user: UserResponse
  currentUserId?: string
  onClose: () => void
  onWrite?: (userId: string) => void
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

export default function UserProfileModal({ user, currentUserId, onClose, onWrite }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showSafetyNumber, setShowSafetyNumber] = useState(false)
  const name = user.first_name || user.username || t("profile.unknownUser")
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const avatarChar = name[0]?.toUpperCase() || "?"
  const avatarColor = getAvatarColor(user.id)
  const avatar = avatarUrl(user.avatar_path)
  const isSelf = !!currentUserId && currentUserId === user.id
  const dialogRef = useRef<HTMLDivElement>(null)

  // APG dialog pattern: фокус внутрь при открытии, Tab зациклен, фокус возвращается на вызвавший элемент.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = dialogRef.current
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, [tabindex]:not([tabindex='-1'])") ?? [])
    focusables()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      const items = focusables()
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el?.addEventListener("keydown", onKey)
    return () => { el?.removeEventListener("keydown", onKey); opener?.focus?.() }
  }, [])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`${t("profile.userProfile")}: ${fullName}`} onClick={onClose}>
      <div ref={dialogRef} className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upm-header">
          <button type="button" className="upm-close" onClick={onClose} aria-label={t("common.close")}>
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="upm-avatar-section">
          {avatar ? (
            // codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна
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
          {!isSelf && (
            <button type="button" className="upm-action-btn" onClick={() => { onClose(); navigate(`/call/${user.id}/audio`) }}>
              <Phone size={18} strokeWidth={2} aria-hidden="true" />
              {t("userProfile.call")}
            </button>
          )}
          {!isSelf && (
            <button type="button" className="upm-action-btn primary" onClick={() => { onClose(); if (onWrite) onWrite(user.id); else navigate("/chat") }}>
              <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />
              {t("userProfile.write")}
            </button>
          )}
          {!isSelf && user.public_key && (
            <button className="upm-action-btn" onClick={() => setShowSafetyNumber(true)}>
              <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />
              {t("userProfile.checkKey")}
            </button>
          )}
        </div>

        {showSafetyNumber && user.public_key && (
          <SafetyNumberModal
            theirUserId={user.id}
            theirPublicKey={user.public_key}
            theirUsername={user.username || user.first_name || t("profile.unknownUser")}
            onClose={() => setShowSafetyNumber(false)}
          />
        )}
      </div>
    </div>
  )
}
