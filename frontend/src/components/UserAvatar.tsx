import { avatarUrl } from "../config"
import { getAvatarColor } from "../utils/avatar"
import { useAvatarStyle } from "../services/avatarStyle"
import Identicon from "./Identicon"

interface UserAvatarProps {
  id: string
  username: string
  avatarPath?: string | null
  /** класс круглого контейнера (cli-avatar-circle, msg-avatar, ch-avatar, modal-user-avatar …) */
  circleClassName: string
  onClick?: () => void
}

// Единый аватар пользователя: загруженное фото, иначе — по настройке:
// геометрическая иконка (дефолт) или буква на стабильном цвете.
// src собирается только через avatarUrl() (allowlist
// media/avatars/…) — произвольные URL и javascript:-схема невозможны.
export default function UserAvatar({ id, username, avatarPath, circleClassName, onClick }: UserAvatarProps) {
  const style = useAvatarStyle()
  const src = avatarUrl(avatarPath)
  if (src) {
    return (
      <div className={circleClassName} style={{ background: "transparent" }} onClick={onClick}>
        {/* codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна */}
        <img src={src} alt={username} className="avatar-img-cover" loading="lazy" />
      </div>
    )
  }
  if (style === "identicon") {
    return (
      <div className={circleClassName} style={{ background: "transparent", overflow: "hidden" }} onClick={onClick}>
        <Identicon seed={id} className="identicon-cover" label={username} />
      </div>
    )
  }
  const char = username?.[0]?.toUpperCase() || "?"
  return (
    <div className={circleClassName} style={{ background: getAvatarColor(id) }} onClick={onClick}>
      <span>{char}</span>
    </div>
  )
}
