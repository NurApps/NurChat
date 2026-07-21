import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { BASE_URL, avatarUrl } from "../config"
import { useAvatar } from "../hooks/useAvatar"
import { hasKeys, clearKeys } from "../services/e2e"
import { isPinEnabled, setPin, clearPin, verifyPin } from "../services/pinLock"
import type { UserResponse } from "../types"

type SettingsTab = "profile" | "notifications" | "privacy" | "storage" | "security" | "account"

const TabIcons = {
  profile: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  notifications: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  privacy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  storage: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  security: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  account: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [status, setStatus] = useState("")
  const [bio, setBio] = useState("")
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<SettingsTab>("profile")
  const { uploading, msg, setMsg, uploadAvatar, deleteAvatar } = useAvatar(setUser)

  const [e2eEnabled, setE2eEnabled] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{total: number; files: number} | null>(null)
  const [pinEnabled, setPinEnabled] = useState(isPinEnabled())
  const [pinSetup, setPinSetup] = useState<"idle" | "set" | "change" | "remove">("idle")
  const [pinInput, setPinInput] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter")
  
  // TOTP 2FA state
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [totpQrCode, setTotpQrCode] = useState<string>("")
  const [totpManualKey, setTotpManualKey] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [totpPassword, setTotpPassword] = useState("")
  const [totpSetupMode, setTotpSetupMode] = useState<"idle" | "setup" | "enable" | "disable">("idle")
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([])
  const [totpLoading, setTotpLoading] = useState(false)

  useEffect(() => {
    api.getCurrentUser()
      .then((u: UserResponse) => {
        setUser(u)
        setFirstName(u.first_name || "")
        setLastName(u.last_name || "")
        setStatus(u.status || "")
        setBio(u.bio || "")
      })
      .catch(() => navigate("/login"))
  }, [navigate])

  useEffect(() => {
    setE2eEnabled(hasKeys())
    api.getStorageInfo?.().then((info: any) => setStorageInfo(info)).catch(() => {})
    loadTotpStatus()
  }, [])

  const loadTotpStatus = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/totp/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTotpEnabled(data.enabled || false)
      }
    } catch (e) {
      console.error("Failed to load TOTP status:", e)
    }
  }

  const handleTotpSetup = async () => {
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/totp/setup`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "X-Password-Confirmation": totpPassword,
        },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Ошибка настройки TOTP")
      }
      const data = await res.json()
      setTotpQrCode(data.qr_code)
      setTotpManualKey(data.manual_entry_key)
      setTotpSetupMode("enable")
      setTotpBackupCodes(data.backup_codes || [])
    } catch (e: any) {
      setMsg(e.message || "Ошибка настройки TOTP")
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpEnable = async () => {
    if (!totpCode || totpCode.length < 6) {
      setMsg("Введите 6-значный код из приложения аутентификации")
      return
    }
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/totp/enable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ code: totpCode }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Ошибка включения TOTP")
      }
      setTotpEnabled(true)
      setTotpSetupMode("idle")
      setTotpCode("")
      setTotpPassword("")
      setMsg("TOTP 2FA успешно включен! Сохраните резервные коды.")
    } catch (e: any) {
      setMsg(e.message || "Ошибка включения TOTP")
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpDisable = async () => {
    if (!totpCode) {
      setMsg("Введите код TOTP или резервный код для отключения")
      return
    }
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/totp/disable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ code: totpCode }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || "Ошибка отключения TOTP")
      }
      setTotpEnabled(false)
      setTotpSetupMode("idle")
      setTotpCode("")
      setTotpPassword("")
      setMsg("TOTP 2FA отключен")
    } catch (e: any) {
      setMsg(e.message || "Ошибка отключения TOTP")
    } finally {
      setTotpLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg("")
    try {
      const form = new FormData()
      form.append("first_name", firstName)
      form.append("last_name", lastName)
      if (status) form.append("status", status)
      if (bio) form.append("bio", bio)
      const res = await fetch(`${BASE_URL}/api/auth/profile/update`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      setUser(updated)
      setMsg("Сохранено")
    } catch (e: any) {
      setMsg(e.message || "Ошибка")
    } finally {
      setSaving(false)
    }
  }

  const handleClearE2EKeys = () => {
    if (!confirm("Вы уверены? Вы не сможете расшифровать старые сообщения.")) return
    clearKeys()
    setE2eEnabled(false)
    setMsg("E2E ключи удалены")
  }

  const handlePinSetup = () => {
    if (pinStep === "enter") {
      if (pinInput.length < 4) { setMsg("PIN должен быть минимум 4 цифры"); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput !== pinConfirm) { setMsg("PIN-коды не совпадают"); return }
      setPin(pinInput).then(() => {
        setPinEnabled(true)
        setPinSetup("idle")
        setPinInput("")
        setPinConfirm("")
        setPinStep("enter")
        setMsg("PIN-код установлен")
      })
    }
  }

  const handlePinChange = async () => {
    if (pinStep === "enter") {
      const ok = await verifyPin(pinInput)
      if (!ok) { setMsg("Неверный текущий PIN"); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput.length < 4) { setMsg("PIN должен быть минимум 4 цифры"); return }
      setPin(pinInput).then(() => {
        setPinEnabled(true)
        setPinSetup("idle")
        setPinInput("")
        setPinConfirm("")
        setPinStep("enter")
        setMsg("PIN-код изменён")
      })
    }
  }

  const handlePinRemove = async () => {
    if (pinStep === "enter") {
      const ok = await verifyPin(pinInput)
      if (!ok) { setMsg("Неверный PIN"); return }
      clearPin()
      setPinEnabled(false)
      setPinSetup("idle")
      setPinInput("")
      setPinStep("enter")
      setMsg("PIN-код отключён")
    }
  }

  const handleClearCache = () => {
    localStorage.removeItem("p2p_keys")
    setMsg("Кэш очищен")
  }

  const handleLogout = () => {
    if (!confirm("Выйти из аккаунта?")) return
    api.clearToken()
    clearPin()
    navigate("/login", { replace: true })
  }

  const handleDeleteAccount = async () => {
    if (!confirm("Вы уверены? Это действие необратимо!")) return
    if (!confirm("Точно удалить аккаунт?")) return
    try {
      api.clearToken()
      clearPin()
      navigate("/login", { replace: true })
    } catch {
      setMsg("Ошибка удаления")
    }
  }

  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  const avatarSrc = avatarUrl(user.avatar_path)
  const initial = user.username[0]?.toUpperCase() || "?"

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: "Профиль", icon: TabIcons.profile },
    { id: "notifications", label: "Уведомления", icon: TabIcons.notifications },
    { id: "privacy", label: "Приватность", icon: TabIcons.privacy },
    { id: "storage", label: "Хранилище", icon: TabIcons.storage },
    { id: "security", label: "Безопасность", icon: TabIcons.security },
    { id: "account", label: "Аккаунт", icon: TabIcons.account },
  ]

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>Настройки</h2>
      </div>

      <div className="settings-body">
        {/* Tab navigation */}
        <div className="settings-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="settings-tab-icon">{t.icon}</span>
              <span className="settings-tab-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-content">
          {/* ─── Profile ─── */}
          {tab === "profile" && (
            <>
              <div className="settings-avatar-section">
                <div className="settings-avatar" style={{ background: avatarSrc ? "transparent" : "#2AABEE" }}>
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="avatar" className="settings-avatar-img" />
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <div className="settings-user-meta">
                  <span className="settings-username">@{user.username}</span>
                  <span className="settings-userid">ID: {user.id}</span>
                </div>
                <div className="avatar-actions">
                  <button className="avatar-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? "..." : "Сменить аватар"}
                  </button>
                  {user.avatar_path && (
                    <button className="avatar-btn danger" onClick={deleteAvatar} disabled={uploading}>
                      Удалить
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadAvatar(file)
                }} />
              </div>

              <div className="settings-fields">
                <label className="settings-label">Имя</label>
                <input className="settings-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />

                <label className="settings-label">Фамилия</label>
                <input className="settings-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />

                <label className="settings-label">Статус</label>
                <input className="settings-input" placeholder="Например: в сети, занят..." value={status} onChange={(e) => setStatus(e.target.value)} />

                <label className="settings-label">О себе</label>
                <textarea className="settings-textarea" rows={3} placeholder="Расскажите о себе..." value={bio} onChange={(e) => setBio(e.target.value)} />
              </div>

              {msg && <p className={`settings-msg ${msg === "Сохранено" ? "ok" : "err"}`}>{msg}</p>}

              <button className="settings-save-btn" disabled={saving} onClick={handleSave}>
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </>
          )}

          {/* ─── Notifications ─── */}
          {tab === "notifications" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Звуки</h3>
                <div className="settings-toggle-row">
                  <span>Звук сообщений</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>Звук звонков</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Отображение</h3>
                <div className="settings-toggle-row">
                  <span>Превью сообщений</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>Уведомления на рабочем столе</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
            </div>
          )}

          {/* ─── Privacy ─── */}
          {tab === "privacy" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Видимость</h3>
                <div className="settings-toggle-row">
                  <span>Показывать статус «в сети»</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>Показывать время последнего входа</span>
                  <label className="settings-toggle"><input type="checkbox" defaultChecked /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Блокировка</h3>
                <p className="settings-info-text">Заблокированные пользователи не смогут отправлять вам сообщения.</p>
                <button className="settings-link-btn">Управление блокировками</button>
              </div>
            </div>
          )}

          {/* ─── Storage ─── */}
          {tab === "storage" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Использование</h3>
                {storageInfo ? (
                  <div className="settings-storage-info">
                    <div className="settings-storage-bar">
                      <div className="settings-storage-fill" style={{ width: `${Math.min(100, (storageInfo.total / (1024 * 1024 * 100)) * 100)}%` }} />
                    </div>
                    <p>{formatSize(storageInfo.total)} использовано · {storageInfo.files} файлов</p>
                  </div>
                ) : (
                  <p className="settings-info-text">Загрузка информации...</p>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Управление</h3>
                <button className="settings-action-btn" onClick={handleClearCache}>Очистить кэш P2P</button>
                <p className="settings-info-text">Файлы старше 30 дней автоматически удаляются.</p>
              </div>
            </div>
          )}

          {/* ─── Security ─── */}
          {tab === "security" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Двухфакторная аутентификация (TOTP)</h3>
                <div className="settings-toggle-row">
                  <span>TOTP 2FA</span>
                  <span className={`settings-badge ${totpEnabled ? "on" : "off"}`}>
                    {totpEnabled ? "Включено" : "Выключено"}
                  </span>
                </div>
                <p className="settings-info-text">
                  {totpEnabled
                    ? "Двухфакторная аутентификация включена. При входе потребуется код из приложения аутентификации."
                    : "Защитите свой аккаунт с помощью TOTP 2FA."}
                </p>
                
                {!totpEnabled && totpSetupMode === "idle" && (
                  <div>
                    <input
                      className="settings-input"
                      type="password"
                      placeholder="Введите пароль для подтверждения"
                      value={totpPassword}
                      onChange={(e) => setTotpPassword(e.target.value)}
                      style={{ width: "100%", marginBottom: 8 }}
                    />
                    <button 
                      className="settings-action-btn" 
                      onClick={handleTotpSetup}
                      disabled={totpLoading || !totpPassword}
                    >
                      {totpLoading ? "Загрузка..." : "Настроить TOTP"}
                    </button>
                  </div>
                )}
                
                {totpSetupMode === "enable" && (
                  <div style={{ padding: 16, borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>1. Отсканируйте QR-код в приложении аутентификации</p>
                    {totpQrCode && (
                      <img src={totpQrCode} alt="TOTP QR Code" style={{ width: 200, height: 200, marginBottom: 12 }} />
                    )}
                    {totpManualKey && (
                      <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                        Ключ для ручного ввода: <strong>{totpManualKey}</strong>
                      </p>
                    )}
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>2. Введите 6-значный код из приложения</p>
                    <input
                      className="settings-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      style={{ width: 140, marginBottom: 12 }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="settings-save-btn"
                        onClick={handleTotpEnable}
                        disabled={totpLoading || totpCode.length !== 6}
                      >
                        {totpLoading ? "Проверка..." : "Включить TOTP"}
                      </button>
                      <button
                        className="avatar-btn"
                        onClick={() => { setTotpSetupMode("idle"); setTotpCode(""); setTotpPassword(""); }}
                        disabled={totpLoading}
                      >
                        Отмена
                      </button>
                    </div>
                    {totpBackupCodes.length > 0 && (
                      <div style={{ marginTop: 16, padding: 12, background: "rgba(76,175,80,0.1)", borderRadius: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#4CAF50", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          <span>Сохраните эти резервные коды в безопасном месте!</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, fontSize: 11 }}>
                          {totpBackupCodes.map((code, i) => (
                            <div key={i} style={{ fontFamily: "monospace", background: "#fff", padding: "2px 6px", borderRadius: 4 }}>
                              {code}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {totpEnabled && (
                  <div>
                    <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Введите код TOTP или резервный код для отключения</p>
                    <input
                      className="settings-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="Код TOTP или резервный код"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      style={{ width: 180, marginBottom: 8 }}
                    />
                    <button 
                      className="settings-action-btn danger" 
                      onClick={handleTotpDisable}
                      disabled={totpLoading || !totpCode}
                    >
                      {totpLoading ? "Отключение..." : "Отключить TOTP"}
                    </button>
                  </div>
                )}
              </div>
              
              <div className="settings-group">
                <h3 className="settings-group-title">End-to-End шифрование</h3>
                <div className="settings-toggle-row">
                  <span>E2E шифрование</span>
                  <span className={`settings-badge ${e2eEnabled ? "on" : "off"}`}>
                    {e2eEnabled ? "Включено" : "Выключено"}
                  </span>
                </div>
                <p className="settings-info-text">
                  {e2eEnabled
                    ? "Ваши сообщения зашифрованы. Только вы и собеседник можете их прочитать."
                    : "E2E ключи не найдены. Сообщения будут отправлены без шифрования."}
                </p>
                {e2eEnabled && (
                  <button className="settings-action-btn danger" onClick={handleClearE2EKeys}>
                    Удалить E2E ключи
                  </button>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">PIN-блокировка</h3>
                <div className="settings-toggle-row">
                  <span>PIN-код</span>
                  <span className={`settings-badge ${pinEnabled ? "on" : "off"}`}>
                    {pinEnabled ? "Включён" : "Выключен"}
                  </span>
                </div>
                {pinSetup === "idle" ? (
                  <div>
                    {pinEnabled ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="settings-action-btn" onClick={() => { setPinSetup("change"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                          Изменить PIN
                        </button>
                        <button className="settings-action-btn danger" onClick={() => { setPinSetup("remove"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                          Отключить
                        </button>
                      </div>
                    ) : (
                      <button className="settings-action-btn" onClick={() => { setPinSetup("set"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                        Установить PIN-код
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="settings-pin-setup">
                    <p className="settings-info-text">
                      {pinSetup === "remove"
                        ? "Введите текущий PIN для отключения"
                        : pinStep === "enter"
                          ? pinSetup === "set"
                            ? "Введите новый PIN-код (4+ цифр)"
                            : "Введите текущий PIN-код"
                          : "Подтвердите PIN-код"}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <input
                        className="settings-input"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                        placeholder="PIN"
                        style={{ width: 120 }}
                      />
                      {pinStep === "confirm" && (
                        <input
                          className="settings-input"
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          value={pinConfirm}
                          onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                          placeholder="Подтвердите"
                          style={{ width: 140 }}
                        />
                      )}
                      <button
                        className="settings-save-btn"
                        style={{ width: "auto", padding: "0 16px", height: 44 }}
                        onClick={pinSetup === "set" ? handlePinSetup : pinSetup === "change" ? handlePinChange : handlePinRemove}
                      >
                        OK
                      </button>
                      <button
                        className="settings-save-btn"
                        style={{ width: "auto", padding: "0 16px", height: 44, background: "#555" }}
                        onClick={() => { setPinSetup("idle"); setPinInput(""); setPinConfirm(""); setPinStep("enter"); setMsg("") }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Сессии</h3>
                <p className="settings-info-text">Вы вошли как @{user.username} на этом устройстве.</p>
                <button className="settings-action-btn danger" onClick={() => { api.clearToken(); clearPin(); navigate("/login", { replace: true }) }}>
                  Выйти из всех устройств
                </button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Дополнительно</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="settings-action-btn" onClick={() => navigate("/backup")}>
                    Бэкапы и восстановление
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/calls")}>
                    История звонков
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/audit")}>
                    История действий
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/blocked")}>
                    Заблокированные
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Account ─── */}
          {tab === "account" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Аккаунт</h3>
                <div className="settings-field-row">
                  <span className="settings-field-label">Username</span>
                  <span className="settings-field-value">@{user.username}</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">ID</span>
                  <span className="settings-field-value">{user.id}</span>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">Действия</h3>
                <button className="settings-action-btn" onClick={handleLogout}>Выйти из аккаунта</button>
                <button className="settings-action-btn danger" onClick={handleDeleteAccount}>Удалить аккаунт</button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">О приложении</h3>
                <div className="settings-field-row">
                  <span className="settings-field-label">Версия</span>
                  <span className="settings-field-value">0.1.0</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">Лицензия</span>
                  <span className="settings-field-value">AGPL-3.0</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">Разработчик</span>
                  <span className="settings-field-value">NurApps</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
