import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { MessageResponse } from "../types"
import { formatTime, formatDateShort } from "../utils/format"

interface PinnedMessageItem {
  id: string
  message_id: string
  pinned_by: string
  created_at: string
  message: {
    id: string
    content: string
    user_id: string
    chat_id: string
    message_type: string
    created_at: string
    username: string
    first_name: string
  }
}

interface Props {
  chatId: string
  isOpen: boolean
  onClose: () => void
  onMessageClick: (messageId: string) => void
}

export function PinnedMessagesModal({ chatId, isOpen, onClose, onMessageClick }: Props) {
  const { t } = useTranslation()
  const [pins, setPins] = useState<PinnedMessageItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOpen || !chatId) return
    setLoading(true)
    api.getPinnedMessages(chatId)
      .then((data) => setPins(data))
      .catch(() => setPins([]))
      .finally(() => setLoading(false))
  }, [chatId, isOpen])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pinned-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t("chat.pinnedMessages")} ({pins.length})</h3>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body pinned-list">
          {loading ? (
            <div className="pinned-loading">{t("common.loading")}</div>
          ) : pins.length === 0 ? (
            <div className="pinned-empty">{t("chat.noPinnedMessages")}</div>
          ) : (
            pins.map((pin) => (
              <div
                key={pin.id}
                className="pinned-item"
                onClick={() => { onMessageClick(pin.message_id); onClose() }}
              >
                <div className="pinned-item-header">
                  <span className="pinned-item-user">{pin.message.first_name || pin.message.username}</span>
                  <span className="pinned-item-date">{formatDateShort(pin.message.created_at)} {formatTime(pin.message.created_at)}</span>
                </div>
                <div className="pinned-item-content">{pin.message.content}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
