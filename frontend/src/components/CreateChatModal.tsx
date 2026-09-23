import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { UserResponse } from "../types"

interface Props {
  currentUserId: string
  onCreate: (participantIds: string[], name: string | null, isSecret?: boolean, secretTtl?: number) => void
  onClose: () => void
}

export default function CreateChatModal({ currentUserId, onCreate, onClose }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [users, setUsers] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showNameInput, setShowNameInput] = useState(false)
  const [groupName, setGroupName] = useState("")
  const [isSecret, setIsSecret] = useState(false)
  const [secretTtl, setSecretTtl] = useState(60)

  useEffect(() => {
    api.getAllUsers()
      .then((all: UserResponse[]) => {
        setUsers(all.filter((u) => u.id !== currentUserId))
      })
      .catch(() => setError("Не удалось загрузить список пользователей"))
      .finally(() => setLoading(false))
  }, [currentUserId])

  const filtered = search
    ? users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))
    : users

  function toggleUser(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleSubmit() {
    if (selectedIds.length === 0) return
    if (selectedIds.length > 1 && !showNameInput) {
      setShowNameInput(true)
      return
    }
    const name = selectedIds.length > 1 ? groupName.trim() || null : null
    onCreate(selectedIds, name, isSecret, secretTtl)
  }

  if (showNameInput) {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Новый чат" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{t("chat.enterGroupName")}</h3>
            <button className="modal-close" onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <input
              className="modal-text-input"
              type="text"
              placeholder={t("chat.enterGroupName")}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-footer">
            <button className="modal-btn cancel" onClick={() => setShowNameInput(false)}>{t("chat.next")}</button>
            <button className="modal-btn primary" onClick={handleSubmit}>
              {t("chat.createChatBtn")}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Новый чат" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t("chat.newChat")}</h3>
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
              placeholder={t("chat.searchUsers")}
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
              <div className="modal-empty">{t("chat.noContacts")}</div>
            ) : (
              filtered.map((user) => (
                <div
                  key={user.id}
                  className={`modal-user-item ${selectedIds.includes(user.id) ? "selected" : ""}`}
                  onClick={() => toggleUser(user.id)}
                >
                  <div className="modal-checkbox">
                    {selectedIds.includes(user.id) && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0e7cb4" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="modal-user-avatar" style={{ background: "#25827c" }}>
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

          {selectedIds.length === 1 && (
            <div className="secret-chat-option">
              <label className="secret-toggle">
                <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
                <span className="secret-toggle-label">{t("chat.secretChatOption")}</span>
              </label>
              {isSecret && (
                <div className="secret-ttl-row">
                  <span>{t("chat.disappearAfter")}</span>
                  <select value={secretTtl} onChange={(e) => setSecretTtl(Number(e.target.value))}>
                    <option value={10}>{t("chat.ephemeral10s")}</option>
                    <option value={30}>{t("chat.ephemeral30s")}</option>
                    <option value={60}>{t("chat.ephemeral1m")}</option>
                    <option value={300}>{t("chat.ephemeral5m")}</option>
                    <option value={900}>{t("chat.ephemeral15m")}</option>
                    <option value={3600}>{t("chat.ephemeral1h")}</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-btn cancel" onClick={onClose}>{t("common.cancel")}</button>
          <button
            className="modal-btn primary"
            disabled={selectedIds.length === 0}
            onClick={handleSubmit}
          >
            {selectedIds.length > 1 ? t("chat.next") : t("chat.createChatBtn")}
          </button>
        </div>
      </div>
    </div>
  )
}
