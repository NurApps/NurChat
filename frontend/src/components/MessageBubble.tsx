import React, { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { MessageResponse, UserResponse } from "../types"
import { api } from "../services/api"
import { getAvatarColor } from "../utils/avatar"
import { formatTime, formatFull } from "../utils/format"
import { renderMarkdown } from "../utils/markdown"
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

function renderHighlightedMarkdown(text: string, query: string): React.ReactNode {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : <React.Fragment key={i}>{renderMarkdown(part)}</React.Fragment>
  )
}

export default function MessageBubble({
  message, currentUser, isMyMessage, isRead = false, status,
  reactions = {}, onDelete, onForward, onReply, onEdit, onReaction, onViewProfile,
  onBookmark, isBookmarked = false, onPin, highlightQuery, onShowInfo,
}: Props) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [readCount, setReadCount] = useState<{ read: number; total: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const content = message.content
  const time = formatTime(message.created_at)
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
      <span className="msg-status read" title={readCount ? `${readCount.read}/${readCount.total} ${t("chat.readStatus")}` : t("chat.readStatus")}>
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
            <button className="msg-edit-cancel" onClick={() => { setEditText(message.content); setEditing(false) }}>{t("common.cancel")}</button>
            <button className="msg-edit-save" onClick={handleEditSave}>{t("common.save")}</button>
          </div>
        </div>
      )
    }
    const replyTo = message.reply_to
    const rendered = highlightQuery
      ? renderHighlightedMarkdown(content, highlightQuery)
      : renderMarkdown(content)
    return (
      <div className="msg-reply-wrapper">
        {replyTo && (
          <div className="msg-reply-border" onClick={() => {/* scroll to replied message */}}>
            <span className="msg-reply-sender">{replyTo.user?.username || t("chat.user")}</span>
            <span className="msg-reply-text">{(replyTo.content || "").slice(0, 60)}{(replyTo.content || "").length > 60 ? "..." : ""}</span>
          </div>
        )}
        <p className="msg-text">
          {message.forwarded_from && <span className="msg-forwarded">⟳ {t("chat.forwarded")}</span>}
          {rendered}
        </p>
      </div>
    )
  }

  const [mediaViewer, setMediaViewer] = useState<{ type: "image" | "video" | "document"; url: string; filename?: string } | null>(null)

  const renderFileContent = () => {
    const mt = message.message_type
    const imageUrl = message.file_id ? api.getFileUrl(message.file_id) : null
    const fileUrl = message.file_id ? api.getFileUrl(message.file_id) : null
    if (mt === "image" && imageUrl) {
      return (
        <div className="msg-file">
          {message.forwarded_from && <span className="msg-forwarded">⟳ {t("chat.forwarded")}</span>}
          <img
            src={imageUrl}
            alt={content}
            className="msg-image"
            loading="lazy"
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
        {message.forwarded_from && <span className="msg-forwarded">⟳ {t("chat.forwarded")}</span>}
        <span className="msg-file-icon">{icon}</span>
        {message.file_id ? (
          <span className="msg-link msg-download-btn">
            {content || t("chat.download")}
          </span>
        ) : (
          <p className="msg-text">{content || t("chat.fileLabel")}</p>
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
          {t("chat.deleteForSelf")}
        </button>
        <button onClick={() => { onDelete?.(message.id, true); setShowDeleteOptions(false); setMenuOpen(false) }}>
          {t("chat.deleteForAll")}
        </button>
        <button className="danger" onClick={() => setShowDeleteOptions(false)}>{t("common.cancel")}</button>
      </div>
    )
  }

  const bubble = (
    <div className={`msg-bubble ${isMyMessage ? "mine" : "other"} ${(message.is_deleted || message.deleted_for_all) ? "deleted" : ""}`}>
      <div className="msg-bubble-inner">
        {(message.is_deleted || message.deleted_for_all) ? (
          <p className="msg-text deleted"><em>{t("chat.messageDeleted")}</em></p>
        ) : editing ? (
          renderContent()
        ) : (
          <>
            {renderContent()}
            <div className="msg-footer">
              <span className="msg-time" title={formatFull(message.created_at)}>
                {time}
              </span>
              {message.edited_at && (
                <span className="msg-edited" title={t("chat.edited")}>{t("chat.editedShort")}</span>
              )}
              {message.expires_at && (
                  <span className="msg-ephemeral" title={t("chat.expiresAt", { time: formatFull(message.expires_at) })}>
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
        { label: t("chat.copy"), action: () => navigator.clipboard.writeText(content) },
        { label: t("common.edit"), action: () => { setEditText(message.content); setEditing(true); setMenuOpen(false) } },
        { label: t("chat.reply"), action: () => onReply?.(message.id) },
        { label: t("chat.forward"), action: () => onForward?.(message.id) },
        { label: isBookmarked ? t("chat.bookmarkRemove") : t("chat.bookmarkAdd"), action: () => onBookmark?.(message.id) },
        { label: t("chat.pin"), action: () => onPin?.(message.id) },
        { label: t("chat.info"), action: () => { setMenuOpen(false); onShowInfo?.(message.id) } },
        { label: t("common.delete"), action: () => setShowDeleteOptions(true) },
      ]
    : [
        { label: t("chat.copy"), action: () => navigator.clipboard.writeText(content) },
        { label: t("chat.reply"), action: () => onReply?.(message.id) },
        { label: t("chat.forward"), action: () => onForward?.(message.id) },
        { label: isBookmarked ? t("chat.bookmarkRemove") : t("chat.bookmarkAdd"), action: () => onBookmark?.(message.id) },
        { label: t("chat.pin"), action: () => onPin?.(message.id) },
        { label: t("chat.info"), action: () => { setMenuOpen(false); onShowInfo?.(message.id) } },
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
          <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label={t("chat.messageMenu")} aria-expanded={menuOpen} aria-haspopup="menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {menuOpen && !showDeleteOptions && (
            <div className="msg-dropdown" role="menu" aria-label={t("chat.messageMenu")}>
              {menuItems.map((item, i) => (
                <button key={item.label} role="menuitem" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); if (e.key === "ArrowDown" && i < menuItems.length - 1) (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); if (e.key === "ArrowUp" && i > 0) (e.currentTarget.previousElementSibling as HTMLElement)?.focus() }}
                  onClick={() => { item.action(); setMenuOpen(false) }}>{item.label}</button>
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
        <button className="msg-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label={t("chat.messageMenu")} aria-expanded={menuOpen} aria-haspopup="menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
        {menuOpen && !showDeleteOptions && (
          <div className="msg-dropdown right" role="menu" aria-label={t("chat.messageMenu")}>
            {menuItems.map((item, i) => (
              <button key={item.label} role="menuitem" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); if (e.key === "ArrowDown" && i < menuItems.length - 1) (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); if (e.key === "ArrowUp" && i > 0) (e.currentTarget.previousElementSibling as HTMLElement)?.focus() }}
                onClick={() => { item.action(); setMenuOpen(false) }}>{item.label}</button>
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
