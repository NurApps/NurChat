import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { avatarUrl } from "../config"
import { getAvatarColor } from "../utils/avatar"
import type { UserResponse } from "../types"

// Совпадает с ограничениями сервера (server/routes/auth.py: upload_avatar).
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"]
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

interface Props {
  user: UserResponse
  uploading: boolean
  onUpload: (file: File) => void
  onDelete: () => void
  onInvalid: (message: string) => void
}

/** Аватар + смена/удаление. Единый для страницы профиля и настроек. */
export default function ProfileAvatar({ user, uploading, onUpload, onDelete, onInvalid }: Props) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const src = avatarUrl(user.avatar_path)
  const initial = (user.first_name?.[0] || user.username[0] || "?").toUpperCase()

  const handleFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ""
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) return onInvalid(t("profile.avatarBadType"))
    if (file.size > AVATAR_MAX_BYTES) return onInvalid(t("profile.avatarTooLarge"))
    onUpload(file)
  }

  const handleDelete = () => {
    if (confirm(t("profile.confirmRemoveAvatar"))) onDelete()
  }

  return (
    <div className="settings-avatar-section">
      <div className="settings-avatar" style={{ background: src ? "transparent" : getAvatarColor(user.id) }}>
        {src ? (
          // codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна
          <img src={src} alt={t("profile.avatarAlt")} width={80} height={80} className="settings-avatar-img" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </div>
      <div className="settings-user-meta">
        <span className="settings-username">@{user.username}</span>
        <span className="settings-userid">ID: {user.id}</span>
      </div>
      <div className="avatar-actions">
        <button type="button" className="avatar-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "..." : t("profile.changeAvatar")}
        </button>
        {user.avatar_path && (
          <button type="button" className="avatar-btn danger" onClick={handleDelete} disabled={uploading}>
            {t("profile.removeAvatar")}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={AVATAR_TYPES.join(",")}
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}
