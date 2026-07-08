import { useState, useEffect } from "react"
import { api } from "../services/api"
import type { UserResponse } from "../types"

interface Props {
  existingContactIds: string[]
  currentUserId: string
  onAdd: (userId: string) => void
  onAddRemote?: (address: string) => void
  onClose: () => void
}

export default function AddContactModal({ existingContactIds, currentUserId, onAdd, onAddRemote, onClose }: Props) {
  const [search, setSearch] = useState("")
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [remoteResult, setRemoteResult] = useState<{ username: string; display_name: string; server_name: string; address: string } | null>(null)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    api.getAllUsers()
      .then((all: UserResponse[]) => {
        const filtered = all.filter(
          (u) => u.id !== currentUserId && !existingContactIds.includes(u.id),
        )
        setUsers(filtered)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentUserId, existingContactIds])

  // Detect remote address pattern (user@host:port)
  const isRemoteAddress = search.includes("@") && search.split("@").length === 2

  const handleResolveRemote = async () => {
    if (!search.includes("@")) return
    setResolving(true)
    setRemoteResult(null)
    try {
      const result = await api.resolveRemoteUser(search.trim())
      if (!result.is_local) {
        setRemoteResult(result as any)
      }
    } catch {
      setRemoteResult(null)
    } finally {
      setResolving(false)
    }
  }

  const filtered = search && !isRemoteAddress
    ? users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Добавить контакт</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Имя или user@host:port"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setRemoteResult(null) }}
              onKeyDown={(e) => { if (isRemoteAddress && e.key === "Enter") handleResolveRemote() }}
              autoFocus
            />
            {isRemoteAddress && (
              <button
                className="modal-btn primary"
                style={{ marginLeft: 8, padding: "4px 12px", fontSize: 12 }}
                onClick={handleResolveRemote}
                disabled={resolving}
              >
                {resolving ? "..." : "Найти"}
              </button>
            )}
          </div>

          {/* Remote user result */}
          {remoteResult && (
            <div
              className={`modal-user-item ${selectedId === remoteResult.address ? "selected" : ""}`}
              onClick={() => setSelectedId(remoteResult.address as any)}
              style={{ cursor: "pointer" }}
            >
              <div className="modal-user-avatar" style={{ background: "#4CAF50" }}>
                <span>@</span>
              </div>
              <div className="modal-user-info">
                <span className="modal-user-name">{remoteResult.display_name || remoteResult.username}</span>
                <span className="modal-user-sub">{remoteResult.address} (удалённый сервер)</span>
              </div>
            </div>
          )}

          <div className="modal-user-list">
            {loading ? (
              <div className="modal-loading">Загрузка...</div>
            ) : filtered.length === 0 && !remoteResult ? (
              <div className="modal-empty">
                {isRemoteAddress ? "Нажмите «Найти» для поиска" : "Нет доступных пользователей"}
              </div>
            ) : (
              filtered.map((user) => (
                <div
                  key={user.id}
                  className={`modal-user-item ${selectedId === user.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(user.id)}
                >
                  <div className="modal-user-avatar" style={{ background: "#2AABEE" }}>
                    <span>{user.username[0]?.toUpperCase() || "?"}</span>
                  </div>
                  <div className="modal-user-info">
                    <span className="modal-user-name">{user.username}</span>
                    <span className="modal-user-sub">{user.first_name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn cancel" onClick={onClose}>Отмена</button>
          <button
            className="modal-btn primary"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return
              if (selectedId.includes("@") && onAddRemote) {
                onAddRemote(selectedId)
              } else {
                onAdd(selectedId)
              }
            }}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  )
}
