import { useState, useEffect } from "react"
import { api } from "../services/api"

interface BookmarkItem {
  id: string
  message_id: string
  user_id: string
  chat_id: string
  created_at: string
  message: {
    id: string
    content: string
    user_id: string
    chat_id: string
    message_type: string
    created_at: string
    user?: { id: string; username: string; first_name: string; avatar_path?: string }
  }
}

interface Props {
  onSelectMessage: (chatId: string, messageId: string) => void
}

export default function BookmarksList({ onSelectMessage }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadBookmarks()
  }, [])

  const loadBookmarks = async () => {
    try {
      const data = await api.getBookmarks()
      setBookmarks(data)
    } catch (e) {
      console.error("Load bookmarks failed:", e)
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (messageId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.removeBookmark(messageId)
      setBookmarks((prev) => prev.filter((b) => b.message_id !== messageId))
    } catch (err) {
      console.error("Remove bookmark failed:", err)
    }
  }

  if (loading) return <p className="list-empty">Загрузка...</p>
  if (bookmarks.length === 0) return <p className="list-empty">Нет избранных сообщений</p>

  return (
    <div className="bookmarks-list">
      {bookmarks.map((bm) => {
        const senderName = bm.message.user?.first_name || bm.message.user?.username || "Пользователь"
        const preview = bm.message.content.length > 60
          ? bm.message.content.slice(0, 60) + "..."
          : bm.message.content
        const time = new Date(bm.message.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        const date = new Date(bm.message.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

        return (
          <div
            key={bm.id}
            className="bookmark-item"
            onClick={() => onSelectMessage(bm.chat_id, bm.message_id)}
          >
            <div className="bookmark-content">
              <div className="bookmark-header">
                <span className="bookmark-sender">{senderName}</span>
                <span className="bookmark-time">{date} {time}</span>
              </div>
              <p className="bookmark-text">{preview}</p>
            </div>
            <button className="bookmark-remove" onClick={(e) => handleRemove(bm.message_id, e)} title="Убрать из избранного">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
