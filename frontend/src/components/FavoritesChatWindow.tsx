import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bookmark, Trash2 } from "lucide-react"
import { useFavoritesStore } from "../store/favoritesStore"
import { formatTime, formatFull } from "../utils/format"
import ConfirmModal from "./ConfirmModal"

interface Props {
  isMobile: boolean
  onClose: () => void
}

export default function FavoritesChatWindow({ isMobile, onClose }: Props) {
  const { t } = useTranslation()
  const items = useFavoritesStore((s) => s.items)
  const addNote = useFavoritesStore((s) => s.addNote)
  const removeEntry = useFavoritesStore((s) => s.remove)
  const clearAll = useFavoritesStore((s) => s.clear)
  const [input, setInput] = useState("")
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [items.length])

  const handleSend = () => {
    if (!input.trim()) return
    addNote(input)
    setInput("")
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        {isMobile && (
          <button className="ch-btn mobile-back" onClick={onClose} aria-label={t("common.back", "Назад")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        <div className="ch-avatar">
          <Bookmark size={20} strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="ch-info">
          <span className="ch-name">{t("chat.bookmarks")}</span>
        </div>
        <div className="ch-actions">
          {items.length > 0 && (
            <button className="ch-btn" title={t("bookmarks.clearAll")} aria-label={t("bookmarks.clearAll")}
              onClick={() => setShowClearConfirm(true)}>
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={messagesRef}>
        {items.length === 0 && <p className="list-empty">{t("bookmarks.empty")}</p>}
        {items.map((item) => (
          <div key={item.id} className="msg-row my-row">
            <div className="msg-bubble mine">
              <div className="msg-bubble-inner">
                <p className="msg-text">
                  {item.forwardedFromName && <span className="msg-forwarded">⟳ {t("chat.forwarded")}</span>}
                  {item.forwardedMessageType && item.forwardedMessageType !== "text" && item.forwardedFileName
                    ? item.forwardedFileName
                    : item.content}
                </p>
                <div className="msg-footer">
                  <span className="msg-time" title={formatFull(item.createdAt)}>{formatTime(item.createdAt)}</span>
                  <button className="bookmark-remove" title={t("bookmarks.remove")} aria-label={t("bookmarks.remove")}
                    onClick={() => removeEntry(item.id)}>
                    <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder={t("bookmarks.notePlaceholder")}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
          }}
        />
        <button className="send-btn" onClick={handleSend} aria-label={t("common.send")} disabled={!input.trim()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>

      {showClearConfirm && (
        <ConfirmModal
          title={t("chat.bookmarks")}
          icon={<Bookmark size={18} strokeWidth={2} aria-hidden="true" />}
          message={t("bookmarks.clearConfirmText")}
          warning={t("bookmarks.clearWarning")}
          onConfirm={clearAll}
          onClose={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  )
}
