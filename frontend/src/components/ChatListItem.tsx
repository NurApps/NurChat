import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { ChatResponse, UserResponse } from "../types"
import { getAvatarColor } from "../utils/avatar"
import { getDraftForChat } from "../utils/drafts"
import { formatFull, formatRelativeTime } from "../utils/format"

interface Props {
  chat: ChatResponse
  currentUser: UserResponse
  onClick: (chatId: string) => void
  onPin?: (chatId: string) => void
  onMute?: (chatId: string) => void
  onDelete?: (chatId: string) => void
}

function getDisplayName(chat: ChatResponse, currentUser: UserResponse, t: (key: string) => string): string {
  if (chat.is_group) return chat.name || t("chat.group")
  const other = chat.participants.find((p) => p.id !== currentUser.id)
  return other?.username || chat.name || t("chat.chat")
}

function getLastMessageTime(chat: ChatResponse): string {
  if (!chat.last_message?.created_at) return ""
  return formatRelativeTime(chat.last_message.created_at)
}

function getLastMessagePreview(chat: ChatResponse, t: (key: string) => string): string {
  if (!chat.last_message?.content) return t("chat.noMessages")
  const c = chat.last_message.content
  return c.length > 35 ? c.slice(0, 35) + "..." : c
}

export default function ChatListItem({ chat, currentUser, onClick, onPin, onMute, onDelete }: Props) {
  const { t } = useTranslation()
  const displayName = getDisplayName(chat, currentUser, t)
  const avatarChar = displayName[0]?.toUpperCase() || "?"
  const avatarColor = getAvatarColor(displayName)
  const lastTime = getLastMessageTime(chat)
  const [draft] = useState(() => getDraftForChat(chat.id))
  const lastPreview = draft || getLastMessagePreview(chat, t)

  const other = chat.participants.find((p) => p.id !== currentUser.id)
  const isOnline = !chat.is_group && (other?.is_online ?? false)
  const unread = chat.unread_count || 0
  const isPinned = chat.is_pinned || false
  const isMuted = chat.is_muted || false

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  return (
    <div className="chat-list-item" onClick={() => onClick(chat.id)}>
      <div className="cli-avatar">
        <div className="cli-avatar-circle" style={{ background: avatarColor }}>
          <span>{avatarChar}</span>
        </div>
        {isOnline && <div className="cli-online-dot" />}
      </div>

      <div className="cli-info">
        <div className="cli-top-row">
          <div className="cli-name-row">
            {isPinned && (
              <svg className="cli-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
              </svg>
            )}
            {isMuted && (
              <svg className="cli-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
            {chat.is_group && (
              <svg className="cli-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            )}
            <span className="cli-name">{displayName}</span>
          </div>
          <span className="cli-time" title={chat.last_message?.created_at ? formatFull(chat.last_message.created_at) : ""}>{lastTime}</span>
          <div className="cli-menu-wrapper" ref={menuRef}>
            <button
              className="cli-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
            </button>
            {menuOpen && (
              <div className="cli-dropdown">
                {onPin && (
                  <button onClick={(e) => { e.stopPropagation(); onPin(chat.id); setMenuOpen(false) }}>
                    {isPinned ? t("chat.unpin") : t("chat.pin")}
                  </button>
                )}
                {onMute && (
                  <button onClick={(e) => { e.stopPropagation(); onMute(chat.id); setMenuOpen(false) }}>
                    {isMuted ? t("chat.unmuteNotifications") : t("chat.muteNotifications")}
                  </button>
                )}
                {onDelete && (
                  <button className="cli-danger" onClick={(e) => { e.stopPropagation(); onDelete(chat.id); setMenuOpen(false) }}>
                    {t("common.delete")} {t("chat.chats")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="cli-bottom-row">
          <span className={`cli-preview ${draft ? "draft-indicator" : ""}`}>{lastPreview}</span>
          {unread > 0 && (
            <span className="cli-badge">{unread >= 100 ? "99+" : unread}</span>
          )}
        </div>
      </div>
    </div>
  )
}
