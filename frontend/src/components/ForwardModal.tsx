import { useState, useEffect } from "react"
import { api } from "../services/api"
import type { ChatResponse } from "../types"

interface Props {
  messageId: string
  sourceChatId?: string
  onForward: (messageId: string, targetChatIds: string[]) => void
  onClose: () => void
}

export default function ForwardModal({ messageId, sourceChatId, onForward, onClose }: Props) {
  const [chats, setChats] = useState<ChatResponse[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.getForwardChats()
      .then((all) => setChats(sourceChatId ? all.filter(c => c.id !== sourceChatId) : all))
      .catch(() => setChats([]))
  }, [sourceChatId])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSend = () => {
    if (selected.size === 0) return
    onForward(messageId, Array.from(selected))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="forward-modal" onClick={(e) => e.stopPropagation()}>
        <div className="forward-header">
          <h3>Переслать сообщение</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="forward-list">
          {chats.length === 0 && <p className="list-empty">Нет чатов для пересылки</p>}
          {chats.map((chat) => {
            const name = chat.is_group
              ? (chat.name || "Группа")
              : chat.participants[0]?.username || "Чат"
            return (
              <label key={chat.id} className="forward-item">
                <input
                  type="checkbox"
                  checked={selected.has(chat.id)}
                  onChange={() => toggle(chat.id)}
                />
                <span>{name}</span>
                {chat.is_group && <span className="forward-group-badge">Группа</span>}
              </label>
            )
          })}
        </div>
        <button className="forward-send" disabled={selected.size === 0} onClick={handleSend}>
          Переслать ({selected.size})
        </button>
      </div>
    </div>
  )
}
