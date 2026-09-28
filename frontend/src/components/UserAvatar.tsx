import { avatarUrl } from "../config"
import { getAvatarColor } from "../utils/avatar"

interface UserAvatarProps {
  id: string
  username: string
  avatarPath?: string | null
  /** класс круглого контейнера (cli-avatar-circle, msg-avatar, ch-avatar, modal-user-avatar …) */
  circleClassName: string
  onClick?: () => void
}

// Единый аватар пользователя: загруженная картинка, иначе буква на
// стабильном цвете. src собирается только через avatarUrl() (allowlist
// media/avatars/…) — произвольные URL и javascript:-схема невозможны.
export default function UserAvatar({ id, username, avatarPath, circleClassName, onClick }: UserAvatarProps) {
  const src = avatarUrl(avatarPath)
  const char = username?.[0]?.toUpperCase() || "?"
  if (src) {
    return (
      <div className={circleClassName} style={{ background: "transparent" }} onClick={onClick}>
        <img src={src} alt={username} className="avatar-img-cover" loading="lazy" />
      </div>
    )
  }
  return (
    <div className={circleClassName} style={{ background: getAvatarColor(id) }} onClick={onClick}>
      <span>{char}</span>
    </div>
  )
}
