import { useState, useCallback, useRef, useEffect } from "react"
import { api } from "../services/api"
import type { MessageResponse, ChatResponse } from "../types"

interface Props {
  chats?: ChatResponse[]
  onSelect?: (chatId: string, messageId: string) => void
  onSelectMessage?: (chatId: string) => void
  onClose: () => void
}

interface SearchResult {
  chat: ChatResponse
  message: MessageResponse
}

export default function GlobalSearch({ chats = [], onSelect, onSelectMessage, onClose }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const messages = await api.globalSearch(query.trim())
      const grouped: SearchResult[] = []
      for (const msg of messages) {
        const chat = chats.find(c => c.id === msg.chat_id)
        if (chat) grouped.push({ chat, message: msg })
      }
      setResults(grouped)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query, chats])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="global-search-input"
            type="text"
            placeholder="Поиск по всем чатам..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button className="global-search-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="global-search-results">
          {searching && <p className="global-search-empty">Поиск...</p>}
          {!searching && results.length === 0 && query.trim() && (
            <p className="global-search-empty">Ничего не найдено</p>
          )}
          {results.map((r) => {
            const time = new Date(r.message.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
            const chatName = r.chat.is_group ? (r.chat.name || "Группа") : (r.chat.participants.find(p => p.id !== r.message.user_id)?.username || "Чат")
            return (
              <div key={r.message.id} className="global-search-item" onClick={() => { (onSelect || onSelectMessage)?.(r.chat.id, r.message.id); onClose() }}>
                <div className="gs-chat-name">{chatName}</div>
                <div className="gs-message">
                  <span className="gs-sender">{r.message.user?.username || "User"}</span>
                  <span className="gs-text">{r.message.content.slice(0, 80)}</span>
                </div>
                <span className="gs-time">{time}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
