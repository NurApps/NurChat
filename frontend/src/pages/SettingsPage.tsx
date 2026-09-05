import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { csrfHeader } from "../services/api"
import { BASE_URL, avatarUrl, getRelayConfig, setRelayConfig, resetRelayConfig } from "../config"
import { useAvatar } from "../hooks/useAvatar"
import { hasKeys, clearKeys } from "../services/e2e"
import { isPinEnabled, setPin, clearPin, verifyPin } from "../services/pinLock"
import { checkForUpdates } from "../services/updateService"
import { platform } from "../services/platform"
import { getSettings, setSetting, clearSettings } from "../services/userSettings"
import { useTheme, THEMES } from "../context/ThemeContext"
import type { UserResponse } from "../types"

type SettingsTab = "profile" | "notifications" | "privacy" | "storage" | "security" | "account" | "database"

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
  database: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<UserResponse | null>(null)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [status, setStatus] = useState("")
  const [bio, setBio] = useState("")
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<SettingsTab>("profile")
  const { uploading, msg, setMsg, uploadAvatar, deleteAvatar } = useAvatar(setUser)
  const [appVersion, setAppVersion] = useState("")
  const [updateStatus, setUpdateStatus] = useState<"checking" | "available" | "latest" | "error" | "">("")
  const [updateUrl, setUpdateUrl] = useState("")

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
  const { theme, setTheme } = useTheme()

  const [relayHost, setRelayHost] = useState("")
  const [relayProtocol, setRelayProtocol] = useState<"http" | "https">("http")
  const [relaySaved, setRelaySaved] = useState(false)
  const [settings, setSettings] = useState(getSettings)

  // Database state
  const [dbStatus, setDbStatus] = useState<{dialect: string; url_masked: string; is_healthy: boolean; table_count: number; size_info: string | null; docker_available: boolean; docker_running: boolean} | null>(null)
  const [pgHost, setPgHost] = useState("localhost")
  const [pgPort, setPgPort] = useState("5432")
  const [pgUser, setPgUser] = useState("nurchat")
  const [pgPassword, setPgPassword] = useState("")
  const [pgDatabase, setPgDatabase] = useState("nurchat")
  const [pgTestResult, setPgTestResult] = useState<{ok: boolean; error?: string; version?: string} | null>(null)
  const [pgLoading, setPgLoading] = useState(false)

  useEffect(() => {
    const cfg = getRelayConfig()
    setRelayHost(cfg.host)
    setRelayProtocol(cfg.protocol)
  }, [])

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
    hasKeys().then(setE2eEnabled).catch(() => setE2eEnabled(false))
    api.getStorageInfo?.().then((info: any) => setStorageInfo(info)).catch(() => {})
    platform.getAppVersion().then(setAppVersion).catch(() => setAppVersion("0.15.0"))
    loadTotpStatus()
    loadDbStatus()
  }, [])

  const loadTotpStatus = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/2fa/status`, {
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

  const loadDbStatus = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/admin/db/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (res.ok) {
        setDbStatus(await res.json())
      }
    } catch (e) {
      console.error("Failed to load DB status:", e)
    }
  }

  const handleTestPg = async () => {
    setPgLoading(true)
    setPgTestResult(null)
    try {
      const res = await fetch(`${BASE_URL}/api/admin/db/test-pg`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ host: pgHost, port: parseInt(pgPort), user: pgUser, password: pgPassword, database: pgDatabase }),
      })
      setPgTestResult(await res.json())
    } catch (e: any) {
      setPgTestResult({ ok: false, error: e.message })
    } finally {
      setPgLoading(false)
    }
  }

  const handleSwitchToPg = async () => {
    if (!confirm("This will update DATABASE_URL in .env and restart the server. Continue?")) return
    setPgLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/api/admin/db/switch-to-pg`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ host: pgHost, port: parseInt(pgPort), user: pgUser, password: pgPassword, database: pgDatabase }),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg("Database URL updated. Restart the server to apply.")
      } else {
        setMsg(data.error || "Failed to switch database")
      }
    } catch (e: any) {
      setMsg(e.message || "Failed to switch database")
    } finally {
      setPgLoading(false)
    }
  }

  const handleStartDockerPg = async () => {
    setPgLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/api/admin/db/start-docker-pg`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await res.json()
      if (data.ok) {
        setMsg("PostgreSQL started. Waiting for health check...")
        setTimeout(loadDbStatus, 3000)
      } else {
        setMsg(data.error || "Failed to start Docker")
      }
    } catch (e: any) {
      setMsg(e.message || "Failed to start Docker")
    } finally {
      setPgLoading(false)
    }
  }

  const handleTotpSetup = async () => {
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/2fa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
        body: JSON.stringify({ password: totpPassword }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || t("settings.totpSetupError"))
      }
      const data = await res.json()
      setTotpQrCode(data.qr_code)
      setTotpManualKey(data.manual_entry_key)
      setTotpSetupMode("enable")
      setTotpBackupCodes(data.backup_codes || [])
    } catch (e: any) {
      setMsg(e.message || t("settings.totpSetupError"))
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpEnable = async () => {
    if (!totpCode || totpCode.length < 6) {
      setMsg(t("settings.totpCodePlaceholder"))
      return
    }
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/2fa/enable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
        body: JSON.stringify({ code: totpCode }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || t("settings.totpEnableError"))
      }
      setTotpEnabled(true)
      setTotpSetupMode("idle")
      setTotpCode("")
      setTotpPassword("")
      setMsg(t("settings.totpEnabledSuccess"))
    } catch (e: any) {
      setMsg(e.message || t("settings.totpEnableError"))
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpDisable = async () => {
    if (!totpCode) {
      setMsg(t("settings.totpCodeOrBackup"))
      return
    }
    setTotpLoading(true)
    setMsg("")
    try {
      const res = await fetch(`${BASE_URL}/api/auth/2fa/disable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
        body: JSON.stringify({ code: totpCode }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || t("settings.totpDisableError"))
      }
      setTotpEnabled(false)
      setTotpSetupMode("idle")
      setTotpCode("")
      setTotpPassword("")
      setMsg(t("settings.totpDisabledSuccess"))
    } catch (e: any) {
      setMsg(e.message || t("settings.totpDisableError"))
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
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          ...(csrfHeader() ? { "X-CSRF-Token": csrfHeader()! } : {}),
        },
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      localStorage.setItem("user", JSON.stringify(updated))
      setUser(updated)
      setMsg(t("settings.saved"))
    } catch (e: any) {
      setMsg(e.message || t("settings.error"))
    } finally {
      setSaving(false)
    }
  }

  const handleClearE2EKeys = async () => {
    if (!confirm(t("settings.confirmClearE2E"))) return
    await clearKeys()
    setE2eEnabled(false)
    setMsg(t("settings.e2eKeysDeleted"))
  }

  const handlePinSetup = () => {
    if (pinStep === "enter") {
      if (pinInput.length < 4) { setMsg(t("settings.pinMinLength")); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput !== pinConfirm) { setMsg(t("settings.pinMismatch")); return }
      setPin(pinInput).then(() => {
        setPinEnabled(true)
        setPinSetup("idle")
        setPinInput("")
        setPinConfirm("")
        setPinStep("enter")
        setMsg(t("settings.pinSetSuccess"))
      })
    }
  }

  const handlePinChange = async () => {
    if (pinStep === "enter") {
      const ok = await verifyPin(pinInput)
      if (!ok) { setMsg(t("settings.pinWrongCurrent")); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput.length < 4) { setMsg(t("settings.pinMinLength")); return }
      setPin(pinInput).then(() => {
        setPinEnabled(true)
        setPinSetup("idle")
        setPinInput("")
        setPinConfirm("")
        setPinStep("enter")
        setMsg(t("settings.pinChanged"))
      })
    }
  }

  const handlePinRemove = async () => {
    if (pinStep === "enter") {
      const ok = await verifyPin(pinInput)
      if (!ok) { setMsg(t("settings.pinWrong")); return }
      clearPin()
      setPinEnabled(false)
      setPinSetup("idle")
      setPinInput("")
      setPinStep("enter")
      setMsg(t("settings.pinRemoved"))
    }
  }

  const handleClearCache = () => {
    setMsg(t("settings.cacheCleared"))
  }

  const handleSaveRelay = () => {
    const host = relayHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
    if (!host) {
      resetRelayConfig()
    } else {
      setRelayConfig({ host, protocol: relayProtocol })
    }
    setRelaySaved(true)
    setTimeout(() => setRelaySaved(false), 3000)
    setMsg(t("settings.relaySaved"))
  }

  const handleLogout = () => {
    if (!confirm(t("settings.confirmLogout"))) return
    api.clearToken()
    clearPin()
    navigate("/login", { replace: true })
  }

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking")
    const result = await checkForUpdates()
    if (!result) {
      setUpdateStatus("error")
    } else if (result.has_update) {
      setUpdateStatus("available")
      setUpdateUrl(result.url)
    } else {
      setUpdateStatus("latest")
    }
  }

  const handleDeleteAccount = async () => {
    if (!confirm(t("settings.confirmDeleteAccount"))) return
    if (!confirm(t("settings.confirmDeleteAccountSecond"))) return
    try {
      await api.deleteAccount()
      clearKeys()
      clearSettings()
      api.clearToken()
      clearPin()
      navigate("/login", { replace: true })
    } catch {
      setMsg(t("settings.deleteError"))
    }
  }

  const handleToggleSetting = (key: keyof typeof settings, value: boolean) => {
    setSettings(setSetting(key, value))
  }

  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  const avatarSrc = avatarUrl(user.avatar_path)
  const initial = user.username[0]?.toUpperCase() || "?"

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: t("settings.profile"), icon: TabIcons.profile },
    { id: "notifications", label: t("settings.notifications"), icon: TabIcons.notifications },
    { id: "privacy", label: t("settings.privacy"), icon: TabIcons.privacy },
    { id: "storage", label: t("settings.storage"), icon: TabIcons.storage },
    { id: "security", label: t("settings.security"), icon: TabIcons.security },
    { id: "account", label: t("settings.account"), icon: TabIcons.account },
    ...(localStorage.getItem("nurchat_debug") === "true" ? [{ id: "database" as SettingsTab, label: "Database", icon: TabIcons.database }] : []),
  ]

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} ${t("files.sizeB")}`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t("files.sizeKB")}`
    return `${(bytes / (1024 * 1024)).toFixed(1)} ${t("files.sizeMB")}`
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>{t("settings.title")}</h2>
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
                    {uploading ? "..." : t("profile.changeAvatar")}
                  </button>
                  {user.avatar_path && (
                    <button className="avatar-btn danger" onClick={deleteAvatar} disabled={uploading}>
                      {t("common.delete")}
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadAvatar(file)
                }} />
              </div>

              <div className="settings-fields">
                <label className="settings-label">{t("profile.firstName")}</label>
                <input className="settings-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />

                <label className="settings-label">{t("profile.lastName")}</label>
                <input className="settings-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />

                <label className="settings-label">{t("settings.status")}</label>
                <input className="settings-input" placeholder={t("settings.statusPlaceholder")} value={status} onChange={(e) => setStatus(e.target.value)} />

                <label className="settings-label">{t("profile.bio")}</label>
                <textarea className="settings-textarea" rows={3} placeholder={t("settings.bioPlaceholder")} value={bio} onChange={(e) => setBio(e.target.value)} />
              </div>

              {msg && <p className={`settings-msg ${msg === t("settings.saved") ? "ok" : "err"}`}>{msg}</p>}

              <button className="settings-save-btn" disabled={saving} onClick={handleSave}>
                {saving ? t("settings.saving") : t("common.save")}
              </button>

              <div className="settings-group" style={{ marginTop: 24 }}>
                <h3 className="settings-group-title">{t("settings.themeTitle")}</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`settings-tab ${theme === t.id ? "active" : ""}`}
                      onClick={() => setTheme(t.id)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: theme === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                        background: theme === t.id ? "var(--surface-variant)" : "var(--card-bg)",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── Notifications ─── */}
          {tab === "notifications" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.sounds")}</h3>
                <div className="settings-toggle-row">
                  <span>{t("settings.messageSound")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.messageSound} onChange={(e) => handleToggleSetting("messageSound", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>{t("settings.callSound")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.callSound} onChange={(e) => handleToggleSetting("callSound", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.display")}</h3>
                <div className="settings-toggle-row">
                  <span>{t("settings.messagePreview")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.messagePreview} onChange={(e) => handleToggleSetting("messagePreview", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>{t("settings.desktopNotifications")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.desktopNotifications} onChange={(e) => handleToggleSetting("desktopNotifications", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
            </div>
          )}

          {/* ─── Privacy ─── */}
          {tab === "privacy" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.visibility")}</h3>
                <div className="settings-toggle-row">
                  <span>{t("settings.showOnline")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.showOnline} onChange={(e) => handleToggleSetting("showOnline", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
                <div className="settings-toggle-row">
                  <span>{t("settings.showLastSeen")}</span>
                  <label className="settings-toggle"><input type="checkbox" checked={settings.showLastSeen} onChange={(e) => handleToggleSetting("showLastSeen", e.target.checked)} /><span className="settings-toggle-slider" /></label>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.blocking")}</h3>
                <p className="settings-info-text">{t("settings.blockingDesc")}</p>
                <button className="settings-link-btn" onClick={() => navigate("/blocked")}>{t("settings.manageBlocking")}</button>
              </div>
            </div>
          )}

          {/* ─── Storage ─── */}
          {tab === "storage" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.usage")}</h3>
                {storageInfo ? (
                  <div className="settings-storage-info">
                    <div className="settings-storage-bar">
                      <div className="settings-storage-fill" style={{ width: `${Math.min(100, (storageInfo.total / (1024 * 1024 * 100)) * 100)}%` }} />
                    </div>
                    <p>{formatSize(storageInfo.total)} {t("settings.used")} · {storageInfo.files} {t("settings.filesCount")}</p>
                  </div>
                ) : (
                  <p className="settings-info-text">{t("settings.loadingInfo")}</p>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.management")}</h3>
                <button className="settings-action-btn" onClick={handleClearCache}>{t("settings.clearP2pCache")}</button>
                <p className="settings-info-text">{t("settings.autoDelete")}</p>
              </div>
            </div>
          )}

          {/* ─── Security ─── */}
          {tab === "security" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.totp2fa")}</h3>
                <div className="settings-toggle-row">
                  <span>TOTP 2FA</span>
                  <span className={`settings-badge ${totpEnabled ? "on" : "off"}`}>
                    {totpEnabled ? t("settings.totpEnabled") : t("settings.totpDisabled")}
                  </span>
                </div>
                <p className="settings-info-text">
                  {totpEnabled
                    ? t("settings.totpEnabledDesc")
                    : t("settings.totpDisabledDesc")}
                </p>
                
                {!totpEnabled && totpSetupMode === "idle" && (
                  <div>
                    <input
                      className="settings-input"
                      type="password"
                      placeholder={t("settings.totpPasswordPlaceholder")}
                      value={totpPassword}
                      onChange={(e) => setTotpPassword(e.target.value)}
                      style={{ width: "100%", marginBottom: 8 }}
                    />
                    <button 
                      className="settings-action-btn" 
                      onClick={handleTotpSetup}
                      disabled={totpLoading || !totpPassword}
                    >
                      {totpLoading ? t("settings.totpLoading") : t("settings.totpSetup")}
                    </button>
                  </div>
                )}
                
                {totpSetupMode === "enable" && (
                  <div style={{ padding: 16, borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>{t("settings.totpScanQr")}</p>
                    {totpQrCode && (
                      <img src={totpQrCode} alt="TOTP QR Code" style={{ width: 200, height: 200, marginBottom: 12 }} />
                    )}
                    {totpManualKey && (
                      <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                        {t("settings.totpManualKey")} <strong>{totpManualKey}</strong>
                      </p>
                    )}
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t("settings.totpEnterCode")}</p>
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
                        {totpLoading ? t("settings.totpCheck") : t("settings.totpEnable")}
                      </button>
                      <button
                        className="avatar-btn"
                        onClick={() => { setTotpSetupMode("idle"); setTotpCode(""); setTotpPassword(""); }}
                        disabled={totpLoading}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                    {totpBackupCodes.length > 0 && (
                      <div style={{ marginTop: 16, padding: 12, background: "rgba(76,175,80,0.1)", borderRadius: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#4CAF50", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          <span>{t("settings.totpSaveBackup")}</span>
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
                    <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{t("settings.totpDisableHint")}</p>
                    <input
                      className="settings-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder={t("settings.totpDisablePlaceholder")}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      style={{ width: 180, marginBottom: 8 }}
                    />
                    <button 
                      className="settings-action-btn danger" 
                      onClick={handleTotpDisable}
                      disabled={totpLoading || !totpCode}
                    >
                      {totpLoading ? t("settings.totpDisabling") : t("settings.totpDisable")}
                    </button>
                  </div>
                )}
              </div>
              
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.e2eTitle")}</h3>
                <div className="settings-toggle-row">
                  <span>{t("settings.e2eEnabled")}</span>
                  <span className={`settings-badge ${e2eEnabled ? "on" : "off"}`}>
                    {e2eEnabled ? t("settings.e2eOn") : t("settings.e2eOff")}
                  </span>
                </div>
                <p className="settings-info-text">
                  {e2eEnabled
                    ? t("settings.e2eEnabledDesc")
                    : t("settings.e2eDisabledDesc")}
                </p>
                {e2eEnabled && (
                  <button className="settings-action-btn danger" onClick={handleClearE2EKeys}>
                    {t("settings.deleteE2eKeys")}
                  </button>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.pinTitle")}</h3>
                <div className="settings-toggle-row">
                  <span>{t("settings.pinCode")}</span>
                  <span className={`settings-badge ${pinEnabled ? "on" : "off"}`}>
                    {pinEnabled ? t("settings.pinEnabled") : t("settings.pinDisabled")}
                  </span>
                </div>
                {pinSetup === "idle" ? (
                  <div>
                    {pinEnabled ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="settings-action-btn" onClick={() => { setPinSetup("change"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                          {t("settings.changePin")}
                        </button>
                        <button className="settings-action-btn danger" onClick={() => { setPinSetup("remove"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                          {t("settings.disablePin")}
                        </button>
                      </div>
                    ) : (
                      <button className="settings-action-btn" onClick={() => { setPinSetup("set"); setPinStep("enter"); setPinInput(""); setMsg("") }}>
                        {t("settings.setPin")}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="settings-pin-setup">
                    <p className="settings-info-text">
                      {pinSetup === "remove"
                        ? t("settings.pinEnterCurrent")
                        : pinStep === "enter"
                          ? pinSetup === "set"
                            ? t("settings.pinEnterNew")
                            : t("settings.pinEnterCurrentCode")
                          : t("settings.pinConfirmCode")}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <input
                        className="settings-input"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={pinInput}
                        onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                        placeholder={t("settings.pinPlaceholder")}
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
                          placeholder={t("settings.pinConfirmPlaceholder")}
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
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.sessions")}</h3>
                <p className="settings-info-text">{t("settings.sessionDesc", { username: user.username })}</p>
                <button className="settings-action-btn danger" onClick={() => { api.clearToken(); clearPin(); navigate("/login", { replace: true }) }}>
                  {t("settings.logoutAllDevices")}
                </button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.advanced")}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="settings-action-btn" onClick={() => navigate("/backup")}>
                    {t("settings.backups")}
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/calls")}>
                    {t("settings.callHistory")}
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/audit")}>
                    {t("settings.actionHistory")}
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/blocked")}>
                    {t("settings.blocked")}
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/webhooks")}>
                    Webhooks
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Account ─── */}
          {tab === "account" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.account")}</h3>
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
                <h3 className="settings-group-title">{t("settings.actions")}</h3>
                <button className="settings-action-btn" onClick={handleLogout}>{t("settings.logoutAccount")}</button>
                <button className="settings-action-btn danger" onClick={handleDeleteAccount}>{t("settings.deleteAccount")}</button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.aboutApp")}</h3>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.version")}</span>
                  <span className="settings-field-value">{appVersion || "0.15.0"}</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.license")}</span>
                  <span className="settings-field-value">AGPL-3.0</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.developer")}</span>
                  <span className="settings-field-value">NurApps</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                  <button className="settings-action-btn" onClick={handleCheckUpdate} disabled={updateStatus === "checking"}>
                    {updateStatus === "checking" ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
                  </button>
                  {updateStatus === "available" && (
                    <button className="settings-action-btn" onClick={() => platform.openExternal(updateUrl)}>
                      {t("settings.downloadVersion", { version: appVersion })}
                    </button>
                  )}
                  {updateStatus === "latest" && (
                    <span style={{ color: "var(--success)", fontSize: "13px" }}>{t("settings.latestVersion")}</span>
                  )}
                  {updateStatus === "error" && (
                    <span style={{ color: "var(--error)", fontSize: "13px" }}>{t("settings.updateError")}</span>
                  )}
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.relay")}</h3>
                <p className="settings-info-text">{t("settings.relayDesc")}</p>
                <label className="settings-label">{t("settings.relayProtocol")}</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {(["http", "https"] as const).map((p) => (
                    <button
                      key={p}
                      className={`settings-tab ${relayProtocol === p ? "active" : ""}`}
                      onClick={() => setRelayProtocol(p)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: relayProtocol === p ? "2px solid var(--accent)" : "2px solid transparent",
                        background: relayProtocol === p ? "var(--surface-variant)" : "var(--card-bg)",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <label className="settings-label">{t("settings.relayHost")}</label>
                <input
                  className="settings-input"
                  placeholder="127.0.0.1:8000"
                  value={relayHost}
                  onChange={(e) => { setRelayHost(e.target.value); setRelaySaved(false) }}
                  style={{ width: "100%", marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="settings-save-btn" onClick={handleSaveRelay} style={{ width: "auto", padding: "0 16px", height: 40 }}>
                    {relaySaved ? t("settings.relaySaved") : t("common.save")}
                  </button>
                  <button className="settings-action-btn" onClick={() => { resetRelayConfig(); setRelayHost(getRelayConfig().host); setRelayProtocol(getRelayConfig().protocol); setMsg(t("settings.relayReset")) }}>
                    {t("settings.relayReset")}
                  </button>
                </div>
                <p className="settings-info-text">{t("settings.relayRestart")}</p>
              </div>
            </div>
          )}

          {/* ─── Database ─── */}
          {tab === "database" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">Current Database</h3>
                {dbStatus ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="settings-field-row">
                      <span className="settings-field-label">Type</span>
                      <span className="settings-field-value" style={{ fontWeight: 600 }}>
                        {dbStatus.dialect === "postgresql" ? "PostgreSQL" : "SQLite"}
                      </span>
                    </div>
                    <div className="settings-field-row">
                      <span className="settings-field-label">Status</span>
                      <span className={`settings-badge ${dbStatus.is_healthy ? "on" : "off"}`}>
                        {dbStatus.is_healthy ? "Healthy" : "Error"}
                      </span>
                    </div>
                    <div className="settings-field-row">
                      <span className="settings-field-label">Tables</span>
                      <span className="settings-field-value">{dbStatus.table_count}</span>
                    </div>
                    {dbStatus.size_info && (
                      <div className="settings-field-row">
                        <span className="settings-field-label">Size</span>
                        <span className="settings-field-value">{dbStatus.size_info}</span>
                      </div>
                    )}
                    <div className="settings-field-row">
                      <span className="settings-field-label">Connection</span>
                      <span className="settings-field-value" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {dbStatus.url_masked}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="spinner" />
                )}
              </div>

              {dbStatus?.dialect === "sqlite" && (
                <div className="settings-group">
                  <h3 className="settings-group-title">Switch to PostgreSQL</h3>
                  <p className="settings-info-text">
                    PostgreSQL is recommended for relay servers with multiple users.
                    It handles concurrent connections better and supports advanced features.
                  </p>

                  {dbStatus.docker_available ? (
                    <div style={{ marginBottom: 16 }}>
                      <p className="settings-info-text" style={{ color: "var(--success)" }}>
                        Docker is available. {dbStatus.docker_running ? "PostgreSQL is running." : "PostgreSQL is not running."}
                      </p>
                      {!dbStatus.docker_running && (
                        <button
                          className="settings-action-btn"
                          onClick={handleStartDockerPg}
                          disabled={pgLoading}
                          style={{ marginTop: 8 }}
                        >
                          {pgLoading ? "Starting..." : "Start PostgreSQL (Docker)"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="settings-info-text" style={{ color: "var(--warning)", marginBottom: 16 }}>
                      Docker not found. Install Docker Desktop or connect to an existing PostgreSQL server.
                    </p>
                  )}

                  <label className="settings-label">Host</label>
                  <input
                    className="settings-input"
                    value={pgHost}
                    onChange={(e) => setPgHost(e.target.value)}
                    placeholder="localhost"
                    style={{ width: "100%", marginBottom: 8 }}
                  />

                  <label className="settings-label">Port</label>
                  <input
                    className="settings-input"
                    value={pgPort}
                    onChange={(e) => setPgPort(e.target.value)}
                    placeholder="5432"
                    style={{ width: 120, marginBottom: 8 }}
                  />

                  <label className="settings-label">User</label>
                  <input
                    className="settings-input"
                    value={pgUser}
                    onChange={(e) => setPgUser(e.target.value)}
                    placeholder="nurchat"
                    style={{ width: "100%", marginBottom: 8 }}
                  />

                  <label className="settings-label">Password</label>
                  <input
                    className="settings-input"
                    type="password"
                    value={pgPassword}
                    onChange={(e) => setPgPassword(e.target.value)}
                    placeholder="Enter password"
                    style={{ width: "100%", marginBottom: 8 }}
                  />

                  <label className="settings-label">Database</label>
                  <input
                    className="settings-input"
                    value={pgDatabase}
                    onChange={(e) => setPgDatabase(e.target.value)}
                    placeholder="nurchat"
                    style={{ width: "100%", marginBottom: 12 }}
                  />

                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      className="settings-action-btn"
                      onClick={handleTestPg}
                      disabled={pgLoading || !pgPassword}
                    >
                      {pgLoading ? "Testing..." : "Test Connection"}
                    </button>
                    <button
                      className="settings-save-btn"
                      onClick={handleSwitchToPg}
                      disabled={pgLoading || !pgPassword || !pgTestResult?.ok}
                      style={{ width: "auto", padding: "0 16px" }}
                    >
                      Switch to PostgreSQL
                    </button>
                  </div>

                  {pgTestResult && (
                    <div style={{
                      padding: 12,
                      borderRadius: 8,
                      background: pgTestResult.ok ? "rgba(76,175,80,0.1)" : "rgba(244,67,54,0.1)",
                      border: `1px solid ${pgTestResult.ok ? "#4CAF50" : "#f44336"}`,
                      fontSize: 13,
                    }}>
                      {pgTestResult.ok ? (
                        <span style={{ color: "#4CAF50" }}>Connected: {pgTestResult.version}</span>
                      ) : (
                        <span style={{ color: "#f44336" }}>Error: {pgTestResult.error}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {dbStatus?.dialect === "postgresql" && (
                <div className="settings-group">
                  <h3 className="settings-group-title">PostgreSQL Tips</h3>
                  <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.8 }}>
                    <p>Backups: <code>pg_dump nurchat {">"} backup.sql</code></p>
                    <p>Restore: <code>psql nurchat {"<"} backup.sql</code></p>
                    <p>Performance: Use connection pooling (PgBouncer) for 100+ users</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
