import { useState } from "react"
import type { MessageResponse, UserResponse } from "../types"
import { api } from "../services/api"

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
}

const REACTION_LIST = ["👍", "❤️", "😂", "😮", "😢", "😡"]

const AVATAR_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function parseLinks(text: string): Array<{ type: "text" | "link"; value: string; href?: string }> {
  const parts: Array<{ type: "text" | "link"; value: string; href?: string }> = []
  const re = /(https?:\/\/[^\s<>"\'()]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>"\'()]*)?)/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) })
    const url = m[0]
    parts.push({ type: "link", value: url, href: url.startsWith("http") ? url : `https://${url}` })
    last = re.lastIndex
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) })
  return parts
}

export default function MessageBubble({
  message, isMyMessage, isRead = false, status,
  reactions = {}, onDelete, onForward, onReply, onEdit, onReaction, onViewProfile,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const content = message.content
  const time = formatTime(message.created_at)
  const isReply = content.startsWith("↩️ Ответ ")
  const peerId = "self"

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
    if (status === "sending") return <span className="msg-status sending">⏳</span>
    if (status === "failed") return <span className="msg-status failed">✗</span>
    if (isRead) return <span className="msg-status read">✓✓</span>
    if (status === "delivered") return <span className="msg-status delivered">✓✓</span>
    return <span className="msg-status sent">✓</span>
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
            <span key={i}>{p.value}</span>
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

  const handleDownload = async (fileId: string, filename: string) => {
    try {
      await api.downloadFile(fileId, filename)
    } catch (e) {
      console.error("Download failed:", e)
    }
  }

  const renderFileContent = () => {
    const mt = message.message_type
    const fileUrl = message.file_id ? api.getFileUrl(message.file_id) : null
    if (mt === "image" && fileUrl) {
      return (
        <div className="msg-file">
          {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <img src={fileUrl} alt={content} className="msg-image" loading="lazy" />
          </a>
        </div>
      )
    }
    if (mt === "voice" && fileUrl) {
      return (
        <div className="msg-file">
          <audio controls src={fileUrl} className="msg-audio" />
        </div>
      )
    }
    if (mt === "audio" && fileUrl) {
      return (
        <div className="msg-file">
          <audio controls src={fileUrl} className="msg-audio" />
        </div>
      )
    }
    if (mt === "video" && fileUrl) {
      return (
        <div className="msg-file">
          <video controls src={fileUrl} className="msg-video" />
        </div>
      )
    }
    const icon = mt === "image" ? "🖼️" : mt === "video" ? "🎬" : mt === "audio" ? "🎵" : mt === "voice" ? "🎤" : "📄"
    return (
      <div className="msg-file">
        {message.forwarded_from && <span className="msg-forwarded">⟳ Переслано</span>}
        <span className="msg-file-icon">{icon}</span>
        {message.file_id ? (
          <button className="msg-link msg-download-btn" onClick={() => handleDownload(message.file_id!, content || "file")}>
            {content || "Скачать файл"}
          </button>
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
    <div className={`msg-bubble ${isMyMessage ? "mine" : "other"} ${message.is_deleted ? "deleted" : ""}`}>
      <div className="msg-bubble-inner">
        {message.is_deleted ? (
          <p className="msg-text deleted"><em>Сообщение удалено</em></p>
        ) : editing ? (
          renderContent()
        ) : (
          <>
            {renderContent()}
            <div className="msg-footer">
              <span className="msg-time">{time}</span>
              {isMyMessage && renderStatusIcon()}
            </div>
            {renderReactionBar()}
          </>
        )}
      </div>
    </div>
  )

  if (message.is_deleted) {
    return (
      <div className={`msg-row ${isMyMessage ? "my-row" : "other-row"}`}>
        {!isMyMessage && (
          <div className="msg-avatar" style={{ background: avatarColor }}>{avatarChar}</div>
        )}
        {bubble}
        {isMyMessage && <div className="msg-spacer" />}
      </div>
    )
  }

  const menuItems = isMyMessage
    ? [
        { label: "Копировать", action: () => navigator.clipboard.writeText(content) },
        { label: "Редактировать", action: () => { setEditText(message.content); setEditing(true); setMenuOpen(false) } },
        { label: "Ответить", action: () => onReply?.(message.id) },
        { label: "Переслать", action: () => onForward?.(message.id) },
        { label: "Удалить", action: () => setShowDeleteOptions(true) },
      ]
    : [
        { label: "Копировать", action: () => navigator.clipboard.writeText(content) },
        { label: "Переслать", action: () => onForward?.(message.id) },
      ]

  if (!isMyMessage) {
    return (
      <div className="msg-row other-row">
        <div
          className="msg-avatar clickable"
          style={{ background: avatarColor }}
          onClick={() => message.user && onViewProfile?.(message.user)}
        >
          {avatarChar}
        </div>
        {bubble}
        <div className="msg-menu-area">
          <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
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
    )
  }

  return (
    <div className="msg-row my-row">
      <div className="msg-spacer" />
      <div className="msg-menu-area">
        <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
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
  )
}
