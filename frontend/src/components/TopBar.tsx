import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpToLine, LogOut, MessageCircle, Moon, Settings, Sun, Users } from "lucide-react"
import { useTheme } from "../context/useTheme"
import { platform } from "../services/platform"

interface Props {
  username: string
  avatarChar: string
  avatarUrl?: string | null
  onProfile?: () => void
  onSettings?: () => void
  onLogout?: () => void
  onSwitchAccount?: () => void
}

export default function TopBar({ username, avatarChar, avatarUrl, onProfile, onSettings, onLogout, onSwitchAccount }: Props) {
  const { t } = useTranslation()
  const { theme, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [menuOpen])

  return (
    <div className="topbar">
      <div className="topbar-left">
        <MessageCircle size={22} color="#2AABEE" strokeWidth={2} aria-hidden="true" />
        <span className="topbar-title">NurChat</span>
      </div>
      <div className="topbar-center">
        <div ref={menuRef} className="topbar-avatar-wrapper">
          <button
            type="button"
            className="topbar-profile-trigger"
            title={t("settings.profile")}
            aria-label={t("settings.profile")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="topbar-username">{username}</span>
            <span className="topbar-avatar">
            {avatarUrl ? (
              // codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна
              <img src={avatarUrl} alt={username} className="topbar-avatar-img" />
            ) : <span aria-hidden="true">{avatarChar}</span>}
            </span>
          </button>
          {menuOpen && (
            <div className="topbar-dropdown">
              <button onClick={() => { setMenuOpen(false); onProfile?.() }}><Settings size={16} strokeWidth={2} aria-hidden="true" />{t("settings.profile")}</button>
              <button onClick={() => { setMenuOpen(false); onSwitchAccount?.() }}><Users size={16} strokeWidth={2} aria-hidden="true" />{t("common.switchAccount")}</button>
              <hr className="dropdown-divider" />
              <button className="danger" onClick={() => { setMenuOpen(false); onLogout?.() }}><LogOut size={16} strokeWidth={2} aria-hidden="true" />{t("common.logout")}</button>
            </div>
          )}
        </div>
      </div>
      <div className="topbar-right">
        <button className="topbar-btn" title={t("settings.title")} aria-label={t("settings.title")} onClick={onSettings}><Settings size={20} strokeWidth={2} aria-hidden="true" /></button>
        <button className="topbar-btn" title={t("common.theme")} aria-label={t("common.theme")} onClick={toggle}>
          {theme === "light" ? <Moon size={20} strokeWidth={2} aria-hidden="true" /> : <Sun size={20} strokeWidth={2} aria-hidden="true" />}
        </button>
        <button className="topbar-btn" title={t("common.minimizeToTray")} aria-label={t("common.minimizeToTray")} onClick={() => platform.minimizeToTray()}><ArrowUpToLine size={20} strokeWidth={2} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
