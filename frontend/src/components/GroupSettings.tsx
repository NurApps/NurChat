import { useState, useEffect } from "react"
import { api } from "../services/api"
import { getAvatarColor } from "../utils/avatar"
import type { ChatResponse, UserResponse } from "../types"

interface GroupMember {
  id: string
  username: string
  first_name: string
  avatar_path: string | null
  is_admin: boolean
  joined_at: string | null
}

interface Props {
  chat: ChatResponse
  currentUser: UserResponse
  onClose: () => void
  onUpdated: () => void
}

export default function GroupSettings({ chat, currentUser, onClose, onUpdated }: Props) {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState(chat.name || "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showAddMember, setShowAddMember] = useState(false)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  const myMember = members.find(m => m.id === currentUser.id)
  const isAdmin = myMember?.is_admin || false

  const loadMembers = async () => {
    try {
      const data = await api.getGroupMembers(chat.id)
      setMembers(data)
    } catch (e) {
      console.error("Load members failed:", e)
    }
  }

  useEffect(() => {
    loadMembers()
  }, [chat.id])

  const handleRename = async () => {
    if (!newName.trim()) return
    setLoading(true)
    setError("")
    try {
      await api.renameGroup(chat.id, newName.trim())
      setEditingName(false)
      onUpdated()
    } catch (e: any) {
      setError(e.message || "Ошибка переименования")
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await api.removeGroupParticipant(chat.id, userId)
      loadMembers()
      onUpdated()
    } catch (e: any) {
      setError(e.message || "Ошибка удаления участника")
    }
  }

  const handleToggleAdmin = async (userId: string) => {
    try {
      await api.setGroupAdmin(chat.id, userId)
      loadMembers()
    } catch (e: any) {
      setError(e.message || "Ошибка назначения админа")
    }
  }

  const handleLeave = async () => {
    if (!confirm("Вы уверены, что хотите выйти из группы?")) return
    try {
      await api.leaveGroup(chat.id)
      onUpdated()
      onClose()
    } catch (e: any) {
      setError(e.message || "Ошибка выхода из группы")
    }
  }

  const handleAddMember = async (userId: string) => {
    try {
      await api.addGroupParticipant(chat.id, userId)
      loadMembers()
      setShowAddMember(false)
      onUpdated()
    } catch (e: any) {
      setError(e.message || "Ошибка добавления участника")
    }
  }

  const loadAllUsers = async () => {
    try {
      const users = await api.getAllUsers()
      setAllUsers(users.filter((u: any) => u.id !== currentUser.id && !members.some(m => m.id === u.id)))
    } catch (e) {
      console.error("Load users failed:", e)
    }
  }

  const openAddMember = () => {
    setShowAddMember(true)
    loadAllUsers()
  }

  const filteredUsers = allUsers.filter((u: any) =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.first_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="media-viewer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="group-settings-modal">
        <div className="group-settings-header">
          <h2>Настройки группы</h2>
          <button className="media-viewer-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="group-settings-body">
          {error && <p className="group-settings-error">{error}</p>}

          {/* Group name */}
          <div className="group-settings-section">
            <label className="group-settings-label">Название группы</label>
            {editingName ? (
              <div className="group-settings-rename">
                <input
                  className="group-settings-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename()}
                  autoFocus
                />
                <button className="group-settings-btn primary" onClick={handleRename} disabled={loading}>
                  {loading ? "..." : "Сохранить"}
                </button>
                <button className="group-settings-btn" onClick={() => { setEditingName(false); setNewName(chat.name || "") }}>
                  Отмена
                </button>
              </div>
            ) : (
              <div className="group-settings-name" onClick={() => isAdmin && setEditingName(true)}>
                <span>{chat.name || "Без названия"}</span>
                {isAdmin && <span className="group-settings-edit-hint">Нажмите, чтобы изменить</span>}
              </div>
            )}
          </div>

          {/* Members */}
          <div className="group-settings-section">
            <div className="group-settings-section-header">
              <label className="group-settings-label">Участники ({members.length})</label>
              {isAdmin && (
                <button className="group-settings-btn small" onClick={openAddMember}>+ Добавить</button>
              )}
            </div>
            <div className="group-settings-members">
              {members.map((member) => (
                <div key={member.id} className="group-settings-member">
                  <div className="group-settings-member-info">
                    <div className="group-settings-avatar" style={{ background: getAvatarColor(member.username) }}>
                      {member.first_name?.[0] || member.username[0]}
                    </div>
                    <div>
                      <span className="group-settings-member-name">
                        {member.first_name || member.username}
                        {member.id === currentUser.id && <span className="group-settings-you"> (Вы)</span>}
                      </span>
                      {member.is_admin && <span className="group-settings-admin-badge">Админ</span>}
                    </div>
                  </div>
                  {isAdmin && member.id !== currentUser.id && (
                    <div className="group-settings-member-actions">
                      <button
                        className="group-settings-btn tiny"
                        onClick={() => handleToggleAdmin(member.id)}
                        title={member.is_admin ? "Снять админа" : "Назначить админом"}
                      >
                        {member.is_admin ? "👤" : "⭐"}
                      </button>
                      <button
                        className="group-settings-btn tiny danger"
                        onClick={() => handleRemoveMember(member.id)}
                        title="Удалить из группы"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Leave group */}
          <div className="group-settings-section">
            <button className="group-settings-btn danger full" onClick={handleLeave}>
              Выйти из группы
            </button>
          </div>
        </div>

        {/* Add member modal */}
        {showAddMember && (
          <div className="media-viewer-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAddMember(false) }}>
            <div className="group-settings-add-modal">
              <h3>Добавить участника</h3>
              <input
                className="group-settings-input"
                placeholder="Поиск по username или имени..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="group-settings-user-list">
                {filteredUsers.map((u: any) => (
                  <div key={u.id} className="group-settings-user-item" onClick={() => handleAddMember(u.id)}>
                    <div className="group-settings-avatar" style={{ background: getAvatarColor(u.username) }}>
                      {u.first_name?.[0] || u.username[0]}
                    </div>
                    <span>{u.first_name || u.username} (@{u.username})</span>
                  </div>
                ))}
                {filteredUsers.length === 0 && <p className="group-settings-empty">Нет пользователей для добавления</p>}
              </div>
              <button className="group-settings-btn" onClick={() => setShowAddMember(false)}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
