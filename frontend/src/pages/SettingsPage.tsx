import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { BASE_URL, avatarUrl } from "../config"
import { useAvatar } from "../hooks/useAvatar"
import type { UserResponse } from "../types"

export default function SettingsPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [status, setStatus] = useState("")
  const [bio, setBio] = useState("")
  const [saving, setSaving] = useState(false)
  const { uploading, msg, setMsg, uploadAvatar, deleteAvatar } = useAvatar(setUser)

  useEffect(() => {
    api.getCurrentUser()
      .then((u: UserResponse) => {
        setUser(u)
        setFirstName(u.first_name || "")
        setLastName(u.last_name || "")
        setStatus(u.status || "")
        setBio(u.bio || "")
      })
      .catch(() => navigate("/login"))
  }, [navigate])

  const handleSave = async () => {
    setSaving(true)
    setMsg("")
    try {
      const form = new FormData()
      form.append("first_name", firstName)
      form.append("last_name", lastName)
      if (status) form.append("status", status)
      if (bio) form.append("bio", bio)
      const res = await fetch(`${BASE_URL}/api/auth/profile/update`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      setMsg("Сохранено")
    } catch (e: any) {
      setMsg(e.message || "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  const avatarSrc = avatarUrl(user.avatar_path)
  const initial = user.username[0]?.toUpperCase() || "?"

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
              <span>{initial}</span>
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
          <label className="settings-label">Имя</label>
          <input className="settings-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />

          <label className="settings-label">Фамилия</label>
          <input className="settings-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />

          <label className="settings-label">Статус</label>
          <input className="settings-input" placeholder="Например: в сети, занят..." value={status} onChange={(e) => setStatus(e.target.value)} />

          <label className="settings-label">О себе</label>
          <textarea className="settings-textarea" rows={3} placeholder="Расскажите о себе..." value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>

        {msg && <p className={`settings-msg ${msg === "Сохранено" ? "ok" : "err"}`}>{msg}</p>}

        <button className="settings-save-btn" disabled={saving} onClick={handleSave}>
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </div>
  )
}
