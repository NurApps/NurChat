import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api, csrfHeader, apiErrorMessage } from "../services/api"
import { BASE_URL, avatarUrl, getRelayConfig, setRelayConfig, resetRelayConfig } from "../config"
import { hasKeys, clearKeys } from "../services/e2e"
import { isPinEnabled, setPin, clearPin, verifyPin } from "../services/pinLock"
import { performLogout, releaseLocalKeys } from "../services/localSession"
import { checkForUpdates } from "../services/updateService"
import { platform } from "../services/platform"
import { getSettings, setSetting, clearSettings } from "../services/userSettings"
import { getAvatarColor } from "../utils/avatar"
import { useTheme, THEMES } from "../context/ThemeContext"
import { AlertTriangle, ArrowLeft, Bell, Database, LockKeyhole, Palette, Settings, Shield, User } from "lucide-react"
import type { UserResponse } from "../types"

type SettingsTab = "profile" | "appearance" | "notifications" | "privacy" | "storage" | "security" | "account"

const TabIcons = {
  profile: <User size={18} strokeWidth={2} aria-hidden="true" />,
  appearance: <Palette size={18} strokeWidth={2} aria-hidden="true" />,
  notifications: <Bell size={18} strokeWidth={2} aria-hidden="true" />,
  privacy: <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />,
  storage: <Database size={18} strokeWidth={2} aria-hidden="true" />,
  security: <Shield size={18} strokeWidth={2} aria-hidden="true" />,
  account: <Settings size={18} strokeWidth={2} aria-hidden="true" />,
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [user, setUser] = useState<UserResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<SettingsTab>("profile")
  const [msg, setMsgText] = useState("")
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok")
  const setMsg = (text: string) => { setMsgText(text); setMsgKind("ok") }
  const setErr = (text: string) => { setMsgText(text); setMsgKind("err") }
  const [lang, setLang] = useState(i18n.language)
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

  useEffect(() => {
    const cfg = getRelayConfig()
    setRelayHost(cfg.host)
    setRelayProtocol(cfg.protocol)
  }, [])

  useEffect(() => {
    api.getCurrentUser()
      .then((u: UserResponse) => setUser(u))
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    hasKeys().then(setE2eEnabled).catch(() => setE2eEnabled(false))
    api.getStorageInfo?.().then((info: any) => setStorageInfo(info)).catch(() => {})
    platform.getAppVersion().then(setAppVersion).catch(() => setAppVersion("0.15.0"))
    loadTotpStatus()
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
      setErr(e.message || t("settings.totpSetupError"))
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpEnable = async () => {
    if (!totpCode || totpCode.length < 6) {
      setErr(t("settings.totpCodePlaceholder"))
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
      setErr(e.message || t("settings.totpEnableError"))
    } finally {
      setTotpLoading(false)
    }
  }

  const handleTotpDisable = async () => {
    if (!totpCode) {
      setErr(t("settings.totpCodeOrBackup"))
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
      setErr(e.message || t("settings.totpDisableError"))
    } finally {
      setTotpLoading(false)
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
      if (pinInput.length < 4) { setErr(t("settings.pinMinLength")); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput !== pinConfirm) { setErr(t("settings.pinMismatch")); return }
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
      if (!ok) { setErr(t("settings.pinWrongCurrent")); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput.length < 4) { setErr(t("settings.pinMinLength")); return }
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
      if (!ok) { setErr(t("settings.pinWrong")); return }
      clearPin()
      setPinEnabled(false)
      setPinSetup("idle")
      setPinInput("")
      setPinStep("enter")
      setMsg(t("settings.pinRemoved"))
    }
  }

  const handleClearCache = () => {
    // Честно: чистим только локальный маркер оффлайн-синхронизации.
    // Черновики, сессии E2E и ключи НЕ трогаем.
    try { localStorage.removeItem("ws_last_message_at") } catch { /* ignore */ }
    setMsg(t("settings.cacheCleared"))
  }

  const handleSaveRelay = () => {
    const host = relayHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
    if (!host) {
      resetRelayConfig()
    } else {
      setRelayConfig({ host, protocol: relayProtocol })
    }
    // BASE_URL/WS_BASE are frozen at module load — a relay switch only takes
    // effect after reload (same as ServerBootOverlay). Sessions/tokens belong
    // to one relay anyway, so a fresh boot on the new host is correct.
    window.location.reload()
  }

  const handleLogout = () => {
    if (!confirm(t("settings.confirmLogout"))) return
    performLogout()
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

  const handleLogoutAll = async () => {
    if (!confirm(t("settings.confirmLogoutAll"))) return
    try {
      await api.logoutAll()
      performLogout()
      navigate("/login", { replace: true })
    } catch (e) {
      setErr(apiErrorMessage(e, t("settings.error")))
    }
  }

  const handleDeleteAccount = async () => {
    if (!confirm(t("settings.confirmDeleteAccount"))) return
    if (!confirm(t("settings.confirmDeleteAccountSecond"))) return
    try {
      await api.deleteAccount()
      await clearKeys()
      releaseLocalKeys()
      clearSettings()
      performLogout()
      navigate("/login", { replace: true })
    } catch {
      setErr(t("settings.deleteError"))
    }
  }

  const handleToggleSetting = (key: keyof typeof settings, value: boolean) => {
    setSettings(setSetting(key, value))
  }

  if (loadError) {
    return (
      <div className="auth-loading">
        <p className="settings-msg err" role="alert">{t("errors.network")}</p>
        <button type="button" className="avatar-btn" onClick={() => window.location.reload()}>{t("common.retry")}</button>
      </div>
    )
  }
  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  const avatarSrc = avatarUrl(user.avatar_path)
  const initial = (user.first_name?.[0] || user.username[0] || "?").toUpperCase()
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: t("settings.profile"), icon: TabIcons.profile },
    { id: "appearance", label: t("settings.appearance"), icon: TabIcons.appearance },
    { id: "notifications", label: t("settings.notifications"), icon: TabIcons.notifications },
    { id: "privacy", label: t("settings.privacy"), icon: TabIcons.privacy },
    { id: "storage", label: t("settings.storage"), icon: TabIcons.storage },
    { id: "security", label: t("settings.security"), icon: TabIcons.security },
    { id: "account", label: t("settings.account"), icon: TabIcons.account },
  ]

  const formatSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return "—"
    if (bytes < 1024) return `${bytes} ${t("files.sizeB")}`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t("files.sizeKB")}`
    return `${(bytes / (1024 * 1024)).toFixed(1)} ${t("files.sizeMB")}`
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button type="button" className="settings-back" onClick={() => navigate("/chat")} aria-label={t("common.back")}>
          <ArrowLeft size={24} strokeWidth={2} aria-hidden="true" />
        </button>
        <h2>{t("settings.title")}</h2>
      </div>

      <div className="settings-body">
        {/* Tab navigation */}
        <div className="settings-tabs" role="tablist">
          {tabs.map((it) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={tab === it.id}
              className={`settings-tab ${tab === it.id ? "active" : ""}`}
              onClick={() => { setTab(it.id); setMsg("") }}
            >
              <span className="settings-tab-icon">{it.icon}</span>
              <span className="settings-tab-label">{it.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-content">
          {msg && <p className={`settings-msg ${msgKind}`} role="status" aria-live="polite">{msg}</p>}

          {/* ─── Profile ─── */}
          {tab === "profile" && (
            <div className="settings-sections">
              <div className="settings-avatar-section">
                <div className="settings-avatar" style={{ background: avatarSrc ? "transparent" : getAvatarColor(user.id) }}>
                  {avatarSrc ? (
                    // codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна
                    <img src={avatarSrc} alt={t("profile.avatarAlt")} width={80} height={80} className="settings-avatar-img" />
                  ) : (
                    <span aria-hidden="true">{initial}</span>
                  )}
                </div>
                <div className="settings-user-meta">
                  <span className="settings-username">{fullName}</span>
                  <span className="settings-userid">@{user.username}</span>
                </div>
              </div>
              <button type="button" className="settings-save-btn" onClick={() => navigate("/profile")}>
                {t("profile.openProfile")}
              </button>
            </div>
          )}

          {/* ─── Appearance ─── */}
          {tab === "appearance" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.themeTitle")}</h3>
                <div className="settings-choices" role="radiogroup" aria-label={t("settings.themeTitle")}>
                  {THEMES.map((th) => (
                    <button
                      key={th.id}
                      type="button"
                      role="radio"
                      aria-checked={theme === th.id}
                      className={`settings-tab settings-choice ${theme === th.id ? "active" : ""}`}
                      onClick={() => setTheme(th.id)}
                    >
                      {th.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.language")}</h3>
                <div className="settings-choices" role="radiogroup" aria-label={t("settings.language")}>
                  {(["ru", "en"] as const).map((lng) => (
                    <button
                      key={lng}
                      type="button"
                      role="radio"
                      aria-checked={lang === lng}
                      className={`settings-tab settings-choice ${lang === lng ? "active" : ""}`}
                      onClick={() => { i18n.changeLanguage(lng); setLang(lng) }}
                    >
                      {lng === "ru" ? "Русский" : "English"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
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
                    <p>{formatSize(storageInfo.total)} {t("settings.used")} · {t("settings.filesCount", { count: storageInfo.files })}</p>
                  </div>
                ) : (
                  <p className="settings-info-text">{t("settings.loadingInfo")}</p>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.management")}</h3>
                <button className="settings-action-btn" onClick={handleClearCache}>{t("settings.clearCache")}</button>
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
                          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                          <span>{t("settings.totpSaveBackup")}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, fontSize: 11 }}>
                          {totpBackupCodes.map((code, i) => (
                            <div key={i} style={{ fontFamily: "monospace", background: "#fff", color: "#000", padding: "2px 6px", borderRadius: 4 }}>
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
                <p className="settings-info-text">{t("settings.logoutAllDesc")}</p>
                <button type="button" className="settings-action-btn danger" onClick={handleLogoutAll}>
                  {t("settings.logoutAllDevices")}
                </button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.advanced")}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="settings-action-btn" onClick={() => navigate("/calls")}>
                    {t("settings.callHistory")}
                  </button>
                  <button className="settings-action-btn" onClick={() => navigate("/blocked")}>
                    {t("settings.blocked")}
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
        </div>
      </div>
    </div>
  )
}
