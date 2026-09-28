import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { ChatResponse, UserResponse } from "../types"
import { getDraftForChat, subscribeDrafts } from "../utils/drafts"
import { formatFull, formatRelativeTime } from "../utils/format"
import { LockKeyhole, MoreVertical, Pin, Users, VolumeX } from "lucide-react"
import UserAvatar from "./UserAvatar"

interface Props {
  chat: ChatResponse
  currentUser: UserResponse
  selected?: boolean
  onClick: (chatId: string) => void
  onPin?: (chatId: string, isPinned: boolean) => void
  onMute?: (chatId: string, isMuted: boolean) => void
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
  // Сервер хранит content="[encrypted]" — сырой маркер в превью не показываем.
  if (c === "[encrypted]") return `🔒 ${t("chat.encryptedMessage")}`
  // Обрезку делает CSS (text-overflow: ellipsis на .cli-preview) — здесь текст не режем,
  // чтобы не дублировать логику и не терять символы раньше, чем реально нужно.
  return c
}

export default function ChatListItem({ chat, currentUser, selected = false, onClick, onPin, onMute, onDelete }: Props) {
  const { t } = useTranslation()
  const displayName = getDisplayName(chat, currentUser, t)
  // Цвет — от стабильного id (пир или чат), а не от отображаемого имени:
  // иначе один и тот же юзер красится по-разному в списке, чате и звонках.
  const otherPeer = chat.participants.find((p) => p.id !== currentUser.id)
  const lastTime = getLastMessageTime(chat)
  const [draft, setDraft] = useState(() => getDraftForChat(chat.id))
  // Черновик может измениться, пока этот пункт списка уже смонтирован (юзер печатает
  // в открытом чате) — подписываемся, чтобы превью не устаревало.
  useEffect(() => {
    setDraft(getDraftForChat(chat.id))
    return subscribeDrafts((changedChatId) => {
      if (changedChatId === chat.id) setDraft(getDraftForChat(chat.id))
    })
  }, [chat.id])
  const lastPreview = draft || getLastMessagePreview(chat, t)

  const other = chat.participants.find((p) => p.id !== currentUser.id)
  const isOnline = !chat.is_group && (other?.is_online ?? false)
  const unread = chat.unread_count || 0
  const isPinned = chat.is_pinned || false
  const isMuted = chat.is_muted || false

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const firstMenuItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    firstMenuItemRef.current?.focus()
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  const closeMenu = (returnFocus: boolean) => {
    setMenuOpen(false)
    if (returnFocus) menuBtnRef.current?.focus()
  }

  const handleActivate = () => onClick(chat.id)

  return (
    <div
      className={`chat-list-item${selected ? " active" : ""}`}
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleActivate() }
      }}
    >
      <div className="cli-avatar">
        {otherPeer && !chat.is_group ? (
          <UserAvatar id={otherPeer.id} username={displayName} avatarPath={otherPeer.avatar_path} circleClassName="cli-avatar-circle" />
        ) : (
          <UserAvatar id={chat.id} username={displayName} circleClassName="cli-avatar-circle" />
        )}
        {isOnline && <div className="cli-online-dot" />}
      </div>

      <div className="cli-info">
        <div className="cli-top-row">
          <div className="cli-name-row">
            {isPinned && (
              <Pin className="cli-icon" size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {isMuted && (
              <VolumeX className="cli-icon" size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {chat.is_group && (
              <Users className="cli-icon" size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {chat.is_secret && (
              <LockKeyhole className="cli-icon" size={14} strokeWidth={2} aria-hidden="true" />
            )}
            <span className="cli-name">{displayName}</span>
          </div>
          <span className="cli-time" title={chat.last_message?.created_at ? formatFull(chat.last_message.created_at) : ""}>{lastTime}</span>
          <div className="cli-menu-wrapper" ref={menuRef}>
            <button
              ref={menuBtnRef}
              className="cli-menu-btn"
              aria-label={t("chat.chatMenu")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
              onKeyDown={(e) => { if (e.key === "Escape" && menuOpen) closeMenu(true) }}
            >
              <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                className="cli-dropdown"
                role="menu"
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(true) } }}
              >
                {onPin && (
                  <button ref={firstMenuItemRef} role="menuitem" onClick={(e) => { e.stopPropagation(); onPin(chat.id, isPinned); closeMenu(false) }}>
                    {isPinned ? t("chat.unpin") : t("chat.pin")}
                  </button>
                )}
                {onMute && (
                  <button role="menuitem" onClick={(e) => { e.stopPropagation(); onMute(chat.id, isMuted); closeMenu(false) }}>
                    {isMuted ? t("chat.unmuteNotifications") : t("chat.muteNotifications")}
                  </button>
                )}
                {onDelete && (
                  <button className="cli-danger" role="menuitem" onClick={(e) => { e.stopPropagation(); onDelete(chat.id); closeMenu(false) }}>
                    {t("chat.deleteChat")}
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
