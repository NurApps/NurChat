import { useState, useEffect, useRef } from "react"
import DOMPurify from "dompurify"
import type { MessageResponse, UserResponse } from "../types"
import { api } from "../services/api"
import { ipfsGatewayUrl } from "../config"
import { getAvatarColor } from "../utils/avatar"
import MediaViewer from "./MediaViewer"
import VoiceMessage from "./VoiceMessage"

interface Props {
  message: MessageResponse
  currentUser: UserResponse
  isMyMessage: boolean
  isRead?: boolean
  status?: string
  reactions?: Record<string, string[]>
  onDelete?: (id: string, deleteForAll?: boolean) => void
  onForward?: (id: string) => void
  onReply?: (id: string) => void
  onEdit?: (id: string, content: string) => void
  onReaction?: (msgId: string, emoji: string, add: boolean) => void
  onViewProfile?: (user: UserResponse) => void
  onShowInfo?: (id: string) => void
  onBookmark?: (messageId: string) => void
  isBookmarked?: boolean
  onPin?: (messageId: string) => void
  highlightQuery?: string
}

const REACTION_LIST = ["👍", "❤️", "😂", "😮", "😢", "😡"]

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function highlightText(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text]
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : part
  )
}

function sanitizeText(text: string): string {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

function parseLinks(text: string): Array<{ type: "text" | "link"; value: string; href?: string }> {
  const safe = sanitizeText(text)
  const parts: Array<{ type: "text" | "link"; value: string; href?: string }> = []
  const re = /(https?:\/\/[^\s<>"\'()]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>"\'()]*)?)/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(safe)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: safe.slice(last, m.index) })
    const url = m[0]
    parts.push({ type: "link", value: url, href: url.startsWith("http") ? url : `https://${url}` })
    last = re.lastIndex
  }
  if (last < safe.length) parts.push({ type: "text", value: safe.slice(last) })
  return parts
}

export default function MessageBubble({
  message, currentUser, isMyMessage, isRead = false, status,
  reactions = {}, onDelete, onForward, onReply, onEdit, onReaction, onViewProfile,
  onBookmark, isBookmarked = false, onPin, highlightQuery, onShowInfo,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [readCount, setReadCount] = useState<{ read: number; total: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const content = message.content
  const time = formatTime(message.created_at)
  const isReply = content.startsWith("↩️ Ответ ")
  const peerId = currentUser.id

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setShowDeleteOptions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  useEffect(() => {
    if (!isMyMessage) return
    api.getReadCount(message.id).then((data) => {
      setReadCount({ read: data.read_count, total: data.total_participants - 1 })
    }).catch(() => {})
  }, [isMyMessage, message.id])

  const senderName = message.user?.username || "User"
  const avatarChar = senderName[0]?.toUpperCase() || "?"
  const avatarColor = getAvatarColor(senderName)

  const handleEditSave = () => {
    if (editText.trim() && editText !== message.content) {
      onEdit?.(message.id, editText.trim())
    }
    setEditing(false)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleEditSave()
    }
    if (e.key === "Escape") {
      setEditText(message.content)
      setEditing(false)
    }
  }

  const renderStatusIcon = () => {
    if (status === "sending") return (
      <span className="msg-status sending">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </span>
    )
    if (status === "failed") return (
      <span className="msg-status failed">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    )
    if (isRead || (readCount && readCount.read > 0)) return (
      <span className="msg-status read" title={readCount ? `${readCount.read}/${readCount.total} прочитали` : "Прочитано"}>
        <svg width="16" height="10" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 8 7 13 13 3"/><polyline points="11 8 16 13 22 3"/></svg>
        {readCount && readCount.total > 1 && <span className="msg-read-count">{readCount.read}/{readCount.total}</span>}
      </span>
    )
    if (status === "delivered") return (
      <span className="msg-status delivered">
        <svg width="16" height="10" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 8 7 13 13 3"/><polyline points="11 8 16 13 22 3"/></svg>
      </span>
    )
    return (
      <span className="msg-status sent">
        <svg width="14" height="10" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 8 9 13 20 2"/></svg>
      </span>
    )
  }

  const renderContent = () => {
    if (message.message_type === "text") return renderTextContent()
    return renderFileContent()
  }

  const renderTextContent = () => {
    if (editing) {
      return (
        <div className="msg-edit-mode">
          <textarea
            className="msg-edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            autoFocus
            rows={2}
          />
          <div className="msg-edit-actions">
            <button className="msg-edit-cancel" onClick={() => { setEditText(message.content); setEditing(false) }}>Отмена</button>
            <button className="msg-edit-save" onClick={handleEditSave}>Сохранить</button>
          </div>
        </div>
      )
    }
    if (isReply) return renderReplyContent()
    const parts = parseLinks(content)
    return (
      <p className="msg-text">
        {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
        {parts.map((p, i) =>
          p.type === "link" ? (
            <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="msg-link">{p.value}</a>
          ) : (
            <span key={i}>{highlightQuery ? highlightText(p.value, highlightQuery) : p.value}</span>
          )
        )}
      </p>
    )
  }

  const renderReplyContent = () => {
    const lines = content.split("\n")
    const quoted = lines[0].replace("↩️ Ответ ", "").trim()
    const reply = lines.slice(1).join("\n")
    const parts = parseLinks(reply)
    return (
      <div className="msg-reply-wrapper">
        <div className="msg-reply-border">
          <span className="msg-reply-sender">{quoted}</span>
          <span className="msg-reply-text">{reply.slice(0, 60)}{reply.length > 60 ? "..." : ""}</span>
        </div>
        {reply && (
          <p className="msg-text">
            {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
            {parts.map((p, i) =>
              p.type === "link" ? (
                <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="msg-link">{p.value}</a>
              ) : (
                <span key={i}>{p.value}</span>
              )
            )}
          </p>
        )}
      </div>
    )
  }

  const [mediaViewer, setMediaViewer] = useState<{ type: "image" | "video" | "document"; url: string; filename?: string } | null>(null)

  const renderFileContent = () => {
    const mt = message.message_type
    const fileUrl = message.file_id ? api.getFileUrl(message.file_id) : null
    // IPFS fallback: use gateway if ipfs_hash is available
    const ipfsUrl = message.file?.ipfs_hash ? ipfsGatewayUrl(message.file.ipfs_hash) : null
    const imageUrl = ipfsUrl || fileUrl
    if (mt === "image" && imageUrl) {
      return (
        <div className="msg-file">
          {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
          <img
            src={imageUrl}
            alt={content}
            className="msg-image"
            loading="lazy"
            onError={(e) => { if (ipfsUrl && fileUrl) (e.target as HTMLImageElement).src = fileUrl }}
            onClick={() => setMediaViewer({ type: "image", url: imageUrl, filename: content || undefined })}
            style={{ cursor: "pointer" }}
          />
        </div>
      )
    }
    if (mt === "voice" && imageUrl) {
      return (
        <div className="msg-file">
          <VoiceMessage src={imageUrl} />
        </div>
      )
    }
    if (mt === "audio" && imageUrl) {
      return (
        <div className="msg-file">
          <audio controls src={imageUrl} className="msg-audio" />
        </div>
      )
    }
    if (mt === "video" && imageUrl) {
      return (
        <div className="msg-file" onClick={() => setMediaViewer({ type: "video", url: imageUrl, filename: content || undefined })} style={{ cursor: "pointer" }}>
          <video src={imageUrl} className="msg-video" preload="metadata" />
          <div className="msg-video-play">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          </div>
        </div>
      )
    }
    const fileIcons: Record<string, React.ReactNode> = {
      image: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
      ),
      video: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      ),
      audio: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
      ),
      voice: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e9b949" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
      file: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    }
    const icon = fileIcons[mt] || fileIcons.file
    return (
      <div className="msg-file" onClick={() => fileUrl && message.file_id && setMediaViewer({ type: "document", url: fileUrl, filename: content || undefined })} style={{ cursor: fileUrl ? "pointer" : undefined }}>
        {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
        <span className="msg-file-icon">{icon}</span>
        {message.file_id ? (
          <span className="msg-link msg-download-btn">
            {content || "Скачать файл"}
          </span>
        ) : (
          <p className="msg-text">{content || "Файл"}</p>
        )}
      </div>
    )
  }

  const renderReactionBar = () => {
    const buttons = REACTION_LIST
      .filter((emoji) => (reactions[emoji]?.length || 0) > 0)
      .map((emoji) => {
        const reactors = reactions[emoji] || []
        const byMe = reactors.includes(peerId)
        return (
          <button
            key={emoji}
            className={`reaction-btn ${byMe ? "mine" : ""}`}
            onClick={() => onReaction?.(message.id, emoji, !byMe)}
          >
            <span className="reaction-emoji">{emoji}</span>
            {reactors.length > 0 && <span className="reaction-count">{reactors.length}</span>}
          </button>
        )
      })
    if (buttons.length === 0) return null
    return <div className="reaction-bar">{buttons}</div>
  }

  const renderDeleteOptions = () => {
    return (
      <div className="msg-delete-options">
        <button onClick={() => { onDelete?.(message.id, false); setShowDeleteOptions(false); setMenuOpen(false) }}>
          Удалить у себя
        </button>
        <button onClick={() => { onDelete?.(message.id, true); setShowDeleteOptions(false); setMenuOpen(false) }}>
          Удалить у всех
        </button>
        <button className="danger" onClick={() => setShowDeleteOptions(false)}>Отмена</button>
      </div>
    )
  }

  const bubble = (
    <div className={`msg-bubble ${isMyMessage ? "mine" : "other"} ${(message.is_deleted || message.deleted_for_all) ? "deleted" : ""}`}>
      <div className="msg-bubble-inner">
        {(message.is_deleted || message.deleted_for_all) ? (
          <p className="msg-text deleted"><em>Сообщение удалено</em></p>
        ) : editing ? (
          renderContent()
        ) : (
          <>
            {renderContent()}
            <div className="msg-footer">
              <span className="msg-time" title={new Date(message.created_at).toLocaleString("ru-RU")}>
                {time}
              </span>
              {message.expires_at && (
                  <span className="msg-ephemeral" title={`Исчезнет ${new Date(message.expires_at).toLocaleString("ru-RU")}`}>
                  <span className="msg-ephemeral-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                </span>
              )}
              {isMyMessage && renderStatusIcon()}
            </div>
            {renderReactionBar()}
          </>
        )}
      </div>
    </div>
  )

  if (message.is_deleted || message.deleted_for_all) {
    return (
      <>
      <div className={`msg-row ${isMyMessage ? "my-row" : "other-row"}`}>
        {!isMyMessage && (
          <div className="msg-avatar" style={{ background: avatarColor }}>{avatarChar}</div>
        )}
        {bubble}
        {isMyMessage && <div className="msg-spacer" />}
      </div>
      {mediaViewer && (
        <MediaViewer
          type={mediaViewer.type}
          url={mediaViewer.url}
          filename={mediaViewer.filename}
          onClose={() => setMediaViewer(null)}
        />
      )}
      </>
    )
  }

  const menuItems = isMyMessage
    ? [
        { label: "Копировать", action: () => navigator.clipboard.writeText(content) },
        { label: "Редактировать", action: () => { setEditText(message.content); setEditing(true); setMenuOpen(false) } },
        { label: "Ответить", action: () => onReply?.(message.id) },
        { label: "Переслать", action: () => onForward?.(message.id) },
        { label: isBookmarked ? "Убрать из избранного" : "В избранное", action: () => onBookmark?.(message.id) },
        { label: "Закрепить", action: () => onPin?.(message.id) },
        { label: "Информация", action: () => { setMenuOpen(false); onShowInfo?.(message.id) } },
        { label: "Удалить", action: () => setShowDeleteOptions(true) },
      ]
    : [
        { label: "Копировать", action: () => navigator.clipboard.writeText(content) },
        { label: "Переслать", action: () => onForward?.(message.id) },
        { label: isBookmarked ? "Убрать из избранного" : "В избранное", action: () => onBookmark?.(message.id) },
        { label: "Закрепить", action: () => onPin?.(message.id) },
        { label: "Информация", action: () => { setMenuOpen(false); onShowInfo?.(message.id) } },
      ]

  if (!isMyMessage) {
    return (
      <>
      <div className="msg-row other-row">
        <div
          className="msg-avatar clickable"
          style={{ background: avatarColor }}
          onClick={() => message.user && onViewProfile?.(message.user)}
        >
          {avatarChar}
        </div>
        {bubble}
        <div className="msg-menu-area" ref={menuRef}>
          <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню сообщения">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {menuOpen && !showDeleteOptions && (
            <div className="msg-dropdown">
              {menuItems.map((item) => (
                <button key={item.label} onClick={() => { item.action(); setMenuOpen(false) }}>{item.label}</button>
              ))}
            </div>
          )}
          {showDeleteOptions && renderDeleteOptions()}
        </div>
        <div className="msg-spacer" />
      </div>
      {mediaViewer && (
        <MediaViewer
          type={mediaViewer.type}
          url={mediaViewer.url}
          filename={mediaViewer.filename}
          onClose={() => setMediaViewer(null)}
        />
      )}
      </>
    )
  }

  return (
    <>
    <div className="msg-row my-row">
      <div className="msg-spacer" />
      <div className="msg-menu-area" ref={menuRef}>
        <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню сообщения">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
        {menuOpen && !showDeleteOptions && (
          <div className="msg-dropdown right">
            {menuItems.map((item) => (
              <button key={item.label} onClick={() => { item.action(); setMenuOpen(false) }}>{item.label}</button>
            ))}
          </div>
        )}
        {showDeleteOptions && renderDeleteOptions()}
      </div>
      {bubble}
    </div>
    {mediaViewer && (
      <MediaViewer
        type={mediaViewer.type}
        url={mediaViewer.url}
        filename={mediaViewer.filename}
        onClose={() => setMediaViewer(null)}
      />
    )}
    </>
  )
}
