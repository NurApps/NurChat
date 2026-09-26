import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowUpToLine, LogOut, MessageCircle, Moon, Settings, Sun, User, Users } from "lucide-react"
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
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus() }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
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
            ref={triggerRef}
            type="button"
            className="topbar-profile-trigger"
            title={t("settings.profile")}
            aria-label={t("settings.profile")}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
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
            <div className="topbar-dropdown" role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); onProfile?.() }}><User size={16} strokeWidth={2} aria-hidden="true" />{t("settings.profile")}</button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); onSwitchAccount?.() }}><Users size={16} strokeWidth={2} aria-hidden="true" />{t("common.switchAccount")}</button>
              <hr className="dropdown-divider" />
              <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onLogout?.() }}><LogOut size={16} strokeWidth={2} aria-hidden="true" />{t("common.logout")}</button>
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
