import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { avatarUrl } from "../config"
import { useAvatar } from "../hooks/useAvatar"
import { formatDateShort } from "../utils/format"
import type { UserResponse } from "../types"

export default function ProfilePage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  const { uploading, msg, uploadAvatar, deleteAvatar } = useAvatar(setUser)

  useEffect(() => {
    api.getCurrentUser()
      .then((u: UserResponse) => setUser(u))
      .catch(() => navigate("/login"))
  }, [navigate])

  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  const avatarSrc = avatarUrl(user.avatar_path)

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>Профиль</h2>
      </div>

      <div className="settings-body">
        <div className="settings-avatar-section">
          <div className="settings-avatar" style={{ background: avatarSrc ? "transparent" : "#2AABEE" }}>
            {avatarSrc ? (
              <img src={avatarSrc} alt="avatar" className="settings-avatar-img" />
            ) : (
              <span>{(user.first_name?.[0] || user.username[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <div className="settings-user-meta">
            <span className="settings-username">@{user.username}</span>
            <span className="settings-userid">ID: {user.id}</span>
          </div>
          <div className="avatar-actions">
            <button className="avatar-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "..." : "Сменить аватар"}
            </button>
            {user.avatar_path && (
              <button className="avatar-btn danger" onClick={deleteAvatar} disabled={uploading}>
                Удалить
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadAvatar(file)
          }} />
        </div>

        <div className="settings-fields">
          <div className="profile-field">
            <span className="profile-field-label">Имя</span>
            <span className="profile-field-value">{user.first_name || "—"}</span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">Фамилия</span>
            <span className="profile-field-value">{user.last_name || "—"}</span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">Статус</span>
            <span className="profile-field-value">{user.status || "—"}</span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">О себе</span>
            <span className="profile-field-value">{user.bio || "—"}</span>
          </div>
          <div className="profile-field">
            <span className="profile-field-label">Дата регистрации</span>
            <span className="profile-field-value">{user.created_at ? formatDateShort(user.created_at) : "—"}</span>
          </div>
        </div>

        {msg && <p className={`settings-msg ${msg.startsWith("Ошиб") ? "err" : "ok"}`}>{msg}</p>}

        <button className="settings-save-btn" onClick={() => navigate("/settings")}>
          Редактировать профиль
        </button>
      </div>
    </div>
  )
}
