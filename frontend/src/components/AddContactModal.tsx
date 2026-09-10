import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { UserResponse } from "../types"

interface Props {
  existingContactIds: string[]
  currentUserId: string
  onAdd: (userId: string) => void
  onClose: () => void
}

export default function AddContactModal({ existingContactIds, currentUserId, onAdd, onClose }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    api.getAllUsers()
      .then((all: UserResponse[]) => {
        const filtered = all.filter(
          (u) => u.id !== currentUserId && !existingContactIds.includes(u.id),
        )
        setUsers(filtered)
      })
      .catch(() => setError("Не удалось загрузить список пользователей"))
      .finally(() => setLoading(false))
  }, [currentUserId, existingContactIds])

  const filtered = search
    ? users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t("contacts.addContact")} onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t("contacts.addContact")}</h3>
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
              placeholder={t("contacts.username")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="modal-user-list">
            {loading ? (
              <div className="modal-loading">{t("common.loading")}</div>
            ) : error ? (
              <div className="modal-empty">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="modal-empty">{t("contacts.noAvailable")}</div>
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
          <button className="modal-btn cancel" onClick={onClose}>{t("common.cancel")}</button>
          <button
            className="modal-btn primary"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return
              onAdd(selectedId)
            }}
          >
            {t("common.add")}
          </button>
        </div>
      </div>
    </div>
  )
}
