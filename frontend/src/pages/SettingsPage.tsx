import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api, csrfHeader, apiErrorMessage } from "../services/api"
import { getAccessToken } from "../services/tokenVault"
import { BASE_URL, avatarUrl, getRelayConfig, resetRelayConfig, parseRelayInput, applyRelayIfHealthy } from "../config"
import { hasKeys, clearKeys } from "../services/e2e"
import CustomThemeEditor from "../components/CustomThemeEditor"
import { customSkinVariant, isCustomSkinId } from "../services/customTheme"
import { isPinEnabled, verifyPin, enablePin, changePin, disablePin } from "../services/pinLock"
import { performLogout, performRelaySwitch, releaseLocalKeys, storedAccount } from "../services/localSession"
import { checkForUpdates } from "../services/updateService"
import { platform } from "../services/platform"
import { getSettings, setSetting, clearSettings } from "../services/userSettings"
import { useAvatarStyle, setAvatarStyle } from "../services/avatarStyle"
import { useTheme, LIGHT_THEMES, DARK_THEMES, type Theme, type ThemeMode } from "../context/ThemeContext"
import { AlertTriangle, ArrowLeft, Bell, ChevronRight, Database, Info, LockKeyhole, LogOut, Camera, Pencil, Palette, Settings, Shield, User } from "lucide-react"
import { getAvatarColor } from "../utils/avatar"
import { useMobile } from "../hooks/useMobile"
import ProfileEditor from "../components/ProfileEditor"
import AccountsManager from "../components/AccountsManager"
import PasskeyManager from "../components/PasskeyManager"
import AccountList from "../components/AccountList"
import RelayAddressInput from "../components/RelayAddressInput"
import type { UserResponse } from "../types"

type SettingsTab = "profile" | "appearance" | "notifications" | "privacy" | "storage" | "security" | "account" | "about"

const TabIcons = {
  profile: <User size={18} strokeWidth={2} aria-hidden="true" />,
  appearance: <Palette size={18} strokeWidth={2} aria-hidden="true" />,
  notifications: <Bell size={18} strokeWidth={2} aria-hidden="true" />,
  privacy: <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />,
  storage: <Database size={18} strokeWidth={2} aria-hidden="true" />,
  security: <Shield size={18} strokeWidth={2} aria-hidden="true" />,
  account: <Settings size={18} strokeWidth={2} aria-hidden="true" />,
  about: <Info size={18} strokeWidth={2} aria-hidden="true" />,
}

const FALLBACK_APP_VERSION = "0.15.0"

export default function SettingsPage() {
  const navigate = useNavigate()
  const { isMobile } = useMobile()
  const { t, i18n } = useTranslation()
  const [user, setUser] = useState<UserResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<SettingsTab>("profile")
  // На телефоне: false — список разделов, true — открытый раздел.
  const [sectionOpen, setSectionOpen] = useState(false)
  // Анимируем возврат к списку только после того, как раздел уже открывали.
  const [everOpened, setEverOpened] = useState(false)
  const [autoEdit, setAutoEdit] = useState(false)
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
  const [pinCurrent, setPinCurrent] = useState("")
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
  const { mode, setMode, lightTheme, setLightTheme, darkTheme, setDarkTheme } = useTheme()

  const [relayHost, setRelayHost] = useState("")
  const [relayProtocol, setRelayProtocol] = useState<"http" | "https">("http")
  const [relaySaved, setRelaySaved] = useState(false)
  const [relayApplying, setRelayApplying] = useState(false)
  const [relayError, setRelayError] = useState("")
  const [settings, setSettings] = useState(getSettings)
  const avatarStyle = useAvatarStyle()
  const profileDirtyRef = useRef(false)

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
    platform.getAppVersion().then(setAppVersion).catch(() => setAppVersion(FALLBACK_APP_VERSION))
    loadTotpStatus()
  }, [])

  const loadTotpStatus = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/2fa/status`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
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
          Authorization: `Bearer ${getAccessToken()}`,
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
          Authorization: `Bearer ${getAccessToken()}`,
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
          Authorization: `Bearer ${getAccessToken()}`,
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

  const resetPinForm = () => {
    setPinSetup("idle")
    setPinInput("")
    setPinConfirm("")
    setPinCurrent("")
    setPinStep("enter")
  }

  const handlePinSetup = () => {
    if (pinStep === "enter") {
      if (pinInput.length < 4) { setErr(t("settings.pinMinLength")); return }
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput !== pinConfirm) { setErr(t("settings.pinMismatch")); return }
      // Re-wrap keystore (null → pin) BEFORE storing the gate: on failure
      // the gate stays off and storage keeps working as before.
      enablePin(pinInput).then(() => {
        setPinEnabled(true)
        resetPinForm()
        setMsg(t("settings.pinSetSuccess"))
      }).catch((e) => {
        console.error("[Settings] enablePin failed:", e)
        setErr(t("settings.pinCryptoError"))
      })
    }
  }

  const handlePinChange = async () => {
    if (pinStep === "enter") {
      const ok = await verifyPin(pinInput)
      if (!ok) { setErr(t("settings.pinWrongCurrent")); return }
      setPinCurrent(pinInput)
      setPinStep("confirm")
      setPinInput("")
      setMsg("")
    } else {
      if (pinInput.length < 4) { setErr(t("settings.pinMinLength")); return }
      try {
        const ok = await changePin(pinCurrent, pinInput)
        if (!ok) { setErr(t("settings.pinWrongCurrent")); resetPinForm(); return }
        setPinEnabled(true)
        resetPinForm()
        setMsg(t("settings.pinChanged"))
      } catch (e) {
        console.error("[Settings] changePin failed:", e)
        setErr(t("settings.pinCryptoError"))
      }
    }
  }

  const handlePinRemove = async () => {
    if (pinStep === "enter") {
      try {
        const ok = await disablePin(pinInput)
        if (!ok) { setErr(t("settings.pinWrong")); return }
        setPinEnabled(false)
        resetPinForm()
        setMsg(t("settings.pinRemoved"))
      } catch (e) {
        console.error("[Settings] disablePin failed:", e)
        setErr(t("settings.pinCryptoError"))
      }
    }
  }

  const handleClearCache = () => {
    // Честно: чистим только локальный маркер оффлайн-синхронизации.
    // Черновики, сессии E2E и ключи НЕ трогаем.
    try { localStorage.removeItem("ws_last_message_at") } catch { /* ignore */ }
    setMsg(t("settings.cacheCleared"))
  }

  const handleSaveRelay = async () => {
    if (relayApplying) return
    const host = parseRelayInput(relayHost).host
    setRelayError("")
    // BASE_URL/WS_BASE are frozen at module load — a relay switch only takes
    // effect after reload (same as ServerBootOverlay). Sessions/tokens belong
    // to one relay anyway, so a fresh boot on the new host is correct.
    if (!host) {
      resetRelayConfig()
      window.location.reload()
      return
    }
    const next = { host, protocol: relayProtocol }
    const current = getRelayConfig()
    // Аккаунт живёт на ОДНОМ реле: молчаливая смена = потеря доступа.
    // Подтвердили, но новый релей не отвечает — остаёмся на старом,
    // сессия не тронута (выход только после успешной проверки).
    let needLogout = false
    if (next.host !== current.host || next.protocol !== current.protocol) {
      const account = storedAccount()
      if (account) {
        if (!window.confirm(t("settings.relaySwitchConfirm", {
          username: account.username,
          from: `${current.protocol}://${current.host}`,
          to: `${next.protocol}://${next.host}`,
        }))) return
        needLogout = true
      }
    }
    // Save only a reachable relay: a typo would otherwise strand the next
    // boot on the "server unavailable" overlay.
    setRelayApplying(true)
    const res = await applyRelayIfHealthy(next)
    if (res.ok) {
      if (needLogout) {
        performRelaySwitch(next)
        return
      }
      window.location.reload()
      return
    }
    setRelayError(t("auth.relayCheckFailed"))
    setRelayApplying(false)
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

  // Вкладка «Профиль» редактируется на месте — не теряем правки при уходе с неё.
  const confirmDiscardProfile = () => {
    if (!profileDirtyRef.current || confirm(t("profile.discardChanges"))) {
      profileDirtyRef.current = false
      return true
    }
    return false
  }

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: t("settings.profile"), icon: TabIcons.profile },
    { id: "appearance", label: t("settings.appearance"), icon: TabIcons.appearance },
    { id: "notifications", label: t("settings.notifications"), icon: TabIcons.notifications },
    { id: "privacy", label: t("settings.privacy"), icon: TabIcons.privacy },
    { id: "storage", label: t("settings.storage"), icon: TabIcons.storage },
    { id: "security", label: t("settings.security"), icon: TabIcons.security },
    { id: "account", label: t("settings.account"), icon: TabIcons.account },
    { id: "about", label: t("settings.aboutApp"), icon: TabIcons.about },
  ]

  const selectTab = (id: SettingsTab) => {
    if (id === tab || !confirmDiscardProfile()) return
    setTab(id)
    setMsg("")
  }

  const openSection = (id: SettingsTab, edit = false) => {
    setTab(id)
    setAutoEdit(edit)
    setMsg("")
    setSectionOpen(true)
    setEverOpened(true)
  }

  const handleBack = () => {
    if (!confirmDiscardProfile()) return
    if (isMobile && sectionOpen) {
      setSectionOpen(false)
      setMsg("")
    } else {
      navigate("/chat")
    }
  }

  const formatSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return "—"
    if (bytes < 1024) return `${bytes} ${t("files.sizeB")}`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t("files.sizeKB")}`
    return `${(bytes / (1024 * 1024)).toFixed(1)} ${t("files.sizeMB")}`
  }

  const avatarSrc = avatarUrl(user.avatar_path)
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const initial = (user.first_name?.[0] || user.username[0] || "?").toUpperCase()
  const modeLabel = mode === "light" ? t("settings.themeModeLight") : mode === "dark" ? t("settings.themeModeDark") : t("settings.themeModeSystem")
  const sectionMeta: Record<string, { color: string; value?: string }> = {
    appearance: { color: "#8e6bd8", value: modeLabel },
    notifications: { color: "#e5534b" },
    privacy: { color: "#34a853" },
    storage: { color: "#f29d38", value: storageInfo ? formatSize(storageInfo.total) : undefined },
    security: { color: "#2a9fd6", value: pinEnabled || totpEnabled ? t("settings.pinEnabled") : t("settings.pinDisabled") },
    account: { color: "#7d8a99" },
    about: { color: "#5b7fd6", value: appVersion || FALLBACK_APP_VERSION },
  }
  const byId = (ids: SettingsTab[]) => ids.map((id) => {
    const tb = tabs.find((x) => x.id === id)!
    return { ...tb, ...sectionMeta[id] }
  })
  const listGroups = [byId(["appearance", "notifications", "privacy", "storage"]), byId(["security", "account"]), byId(["about"])]

  const showList = isMobile && !sectionOpen
  const showSection = !isMobile || sectionOpen
  const headerTitle = isMobile && sectionOpen ? tabs.find((x) => x.id === tab)?.label : t("settings.title")

  const handleTabsKeyDown = (e: React.KeyboardEvent) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const i = tabs.findIndex((x) => x.id === tab)
    const next = e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    selectTab(tabs[next].id)
    document.getElementById(`settings-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <div className="settings-page">
      {!showList && <div className="settings-header">
        {!showList && (
          <button type="button" className="settings-back" onClick={handleBack} aria-label={t("common.back")}>
            <ArrowLeft size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <h2>{headerTitle}</h2>
      </div>}

      <div className="settings-body">
       {showList && (
        <div className="settings-hero" style={{ ["--hero-color" as string]: getAvatarColor(user.id) }}>
          <button type="button" className="settings-hero__edit" onClick={() => openSection("profile", true)}>{t("settings.editShort")}</button>
          <div className="settings-hero__main">
            <span className="settings-hero__avatar">
              {avatarSrc ? (
                // codeql[js/xss-through-dom]: src собран avatarUrl() (config.ts: BASE_URL + allowlist-путь), javascript:-схема невозможна
                <img src={avatarSrc} alt="" width={96} height={96} />
              ) : <span aria-hidden="true">{initial}</span>}
            </span>
            <span className="settings-hero__name">{displayName}</span>
            <span className="settings-hero__sub">@{user.username}</span>
          </div>
        </div>
       )}
       <div className="settings-layout">
        {showList && (
          <div className={`settings-mobile-home${everOpened ? " settings-slide-back" : ""}`}>
            <div className="settings-hero-actions settings-list">
              <button type="button" className="settings-item settings-item--action" onClick={() => openSection("profile")}>
                <Camera size={22} strokeWidth={1.8} aria-hidden="true" />
                <span className="settings-item__label">{t("settings.changePhoto")}</span>
              </button>
              <button type="button" className="settings-item settings-item--action" onClick={() => openSection("profile", true)}>
                <Pencil size={22} strokeWidth={1.8} aria-hidden="true" />
                <span className="settings-item__label">{t("profile.editProfile")}</span>
              </button>
            </div>
            <AccountList variant="settings" activeAvatarSrc={avatarSrc} />
            {listGroups.map((group, gi) => (
              <nav key={gi} className="settings-list" aria-label={t("settings.title")}>
                {group.map((it) => (
                  <button key={it.id} type="button" className="settings-item" onClick={() => openSection(it.id)}>
                    <span className="settings-item__icon" style={{ background: it.color }}>{it.icon}</span>
                    <span className="settings-item__label">{it.label}</span>
                    {it.value && <span className="settings-item__value">{it.value}</span>}
                    <ChevronRight className="settings-item__arrow" size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                ))}
              </nav>
            ))}
            <div className="settings-list">
              <button type="button" className="settings-item settings-item--danger" onClick={handleLogout}>
                <span className="settings-item__icon" style={{ background: "var(--danger)" }}><LogOut size={18} strokeWidth={2} aria-hidden="true" /></span>
                <span className="settings-item__label">{t("settings.logoutAccount")}</span>
              </button>
            </div>
          </div>
        )}

        {!isMobile && (
          <div className="settings-tabs" role="tablist" aria-orientation="vertical" onKeyDown={handleTabsKeyDown}>
            {tabs.map((it) => (
              <button
                key={it.id}
                id={`settings-tab-${it.id}`}
                type="button"
                role="tab"
                aria-selected={tab === it.id}
                aria-controls="settings-panel"
                tabIndex={tab === it.id ? 0 : -1}
                className={`settings-tab ${tab === it.id ? "active" : ""}`}
                onClick={() => {
                  selectTab(it.id)
                }}
              >
                <span className="settings-tab-icon">{it.icon}</span>
                <span className="settings-tab-label">{it.label}</span>
              </button>
            ))}
          </div>
        )}

        {showSection && (
        <div
          className={`settings-content${isMobile ? " settings-slide-forward" : ""}`}
          id="settings-panel"
          key={isMobile ? tab : undefined}
          role={isMobile ? "region" : "tabpanel"}
          aria-labelledby={isMobile ? undefined : `settings-tab-${tab}`}
          aria-label={isMobile ? headerTitle : undefined}
        >
          {msg && <p className={`settings-msg ${msgKind}`} role="status" aria-live="polite">{msg}</p>}

          {/* ─── Profile ─── */}
          {tab === "profile" && (
            <ProfileEditor autoEdit={autoEdit} user={user} onUserChange={setUser} onDirtyChange={(d) => { profileDirtyRef.current = d }} />
          )}

          {/* ─── Appearance ─── */}
          {tab === "appearance" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.themeMode")}</h3>
                <div className="settings-choices" role="radiogroup" aria-label={t("settings.themeMode")}>
                  {([
                    { id: "light", label: t("settings.themeModeLight") },
                    { id: "dark", label: t("settings.themeModeDark") },
                    { id: "system", label: t("settings.themeModeSystem") },
                  ] as { id: ThemeMode; label: string }[]).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={mode === m.id}
                      className={`settings-tab settings-choice ${mode === m.id ? "active" : ""}`}
                      onClick={() => setMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.themeLightTitle")}</h3>
                <div className="theme-swatches" role="radiogroup" aria-label={t("settings.themeLightTitle")}>
                  {LIGHT_THEMES.map((th) => (
                    <ThemeSwatchButton key={th.id} id={th.id} label={th.label} checked={lightTheme === th.id} onSelect={() => setLightTheme(th.id)} />
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.themeDarkTitle")}</h3>
                <div className="theme-swatches" role="radiogroup" aria-label={t("settings.themeDarkTitle")}>
                  {DARK_THEMES.map((th) => (
                    <ThemeSwatchButton key={th.id} id={th.id} label={th.label} checked={darkTheme === th.id} onSelect={() => setDarkTheme(th.id)} />
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.customThemeTitle")}</h3>
                <p className="settings-info-text">{t("settings.themeLightTitle")}</p>
                <CustomThemeEditor variant="light" />
                <p className="settings-info-text" style={{ marginTop: 12 }}>{t("settings.themeDarkTitle")}</p>
                <CustomThemeEditor variant="dark" />
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
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.avatarStyle")}</h3>
                <p className="settings-info-text">{t("settings.avatarStyleDesc")}</p>
                <div className="settings-choices" role="radiogroup" aria-label={t("settings.avatarStyle")}>
                  {(["identicon", "letter"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={avatarStyle === st}
                      className={`settings-tab settings-choice ${avatarStyle === st ? "active" : ""}`}
                      onClick={() => setAvatarStyle(st)}
                    >
                      {st === "identicon" ? t("settings.avatarIdenticon") : t("settings.avatarLetters")}
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
                <h3 className="settings-group-title">{t("settings.blocking")}</h3>
                <p className="settings-info-text">{t("settings.blockingDesc")}</p>
                <button className="settings-link-btn" onClick={() => navigate("/blocked")}>{t("settings.manageBlocking")}</button>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.callHistory")}</h3>
                <button className="settings-link-btn" onClick={() => navigate("/calls")}>{t("settings.openCallHistory")}</button>
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
                    <p>{formatSize(storageInfo.total)} {t("settings.used")} · {t("settings.filesCount", { count: storageInfo.files })}</p>
                  </div>
                ) : (
                  <p className="settings-info-text">{t("settings.loadingInfo")}</p>
                )}
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.management")}</h3>
                <button className="settings-action-btn" onClick={handleClearCache}>{t("settings.clearCache")}</button>
                <p className="settings-info-text">{t("settings.clearCacheDesc")}</p>
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
                  <span>{t("settings.totp2faShort")}</span>
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
                      <img src={totpQrCode} alt={t("settings.totpQrAlt")} style={{ width: 200, height: 200, marginBottom: 12 }} />
                    )}
                    {totpManualKey && (
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
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
                      <div style={{ marginTop: 16, padding: 12, background: "var(--surface-variant)", borderRadius: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                          <span>{t("settings.totpSaveBackup")}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, fontSize: 11 }}>
                          {totpBackupCodes.map((code, i) => (
                            <div key={i} style={{ fontFamily: "monospace", background: "var(--card-bg)", color: "var(--text-primary)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 4 }}>
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
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{t("settings.totpDisableHint")}</p>
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
                <h3 className="settings-group-title">{t("settings.passkeyTitle")}</h3>
                <p className="settings-info-text">{t("settings.passkeyDesc")}</p>
                <PasskeyManager />
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
                        {t("common.ok")}
                      </button>
                      <button
                        className="settings-save-btn"
                        style={{ width: "auto", padding: "0 16px", height: 44, background: "var(--text-secondary)" }}
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
            </div>
          )}

          {/* ─── Account ─── */}
          {tab === "account" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.account")}</h3>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.username")}</span>
                  <span className="settings-field-value">@{user.username}</span>
                </div>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.userId")}</span>
                  <span className="settings-field-value">{user.id}</span>
                </div>
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.actions")}</h3>
                <button className="settings-action-btn" onClick={handleLogout}>{t("settings.logoutAccount")}</button>
                <button className="settings-action-btn danger" onClick={handleDeleteAccount}>{t("settings.deleteAccount")}</button>
              </div>
              <AccountsManager showList={!isMobile} activeAvatarSrc={avatarSrc} />
            </div>
          )}

          {/* ─── About ─── */}
          {tab === "about" && (
            <div className="settings-sections">
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.aboutApp")}</h3>
                <div className="settings-field-row">
                  <span className="settings-field-label">{t("settings.version")}</span>
                  <span className="settings-field-value">{appVersion || FALLBACK_APP_VERSION}</span>
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
                <label className="settings-label">{t("settings.relayHost")}</label>
                <div style={{ marginBottom: 8 }}>
                  <RelayAddressInput
                    protocol={relayProtocol}
                    host={relayHost}
                    onProtocolChange={(p) => { setRelayProtocol(p); setRelaySaved(false); setRelayError("") }}
                    onHostChange={(h) => { setRelayHost(h); setRelaySaved(false); setRelayError("") }}
                    onSubmit={handleSaveRelay}
                    placeholder="127.0.0.1:8000"
                  />
                </div>
                {relayError && <p style={{ color: "var(--error)", fontSize: 13, margin: "0 0 8px" }}>{relayError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="settings-save-btn" onClick={handleSaveRelay} disabled={relayApplying} style={{ width: "auto", padding: "0 16px", height: 40 }}>
                    {relayApplying ? t("auth.relayChecking") : relaySaved ? t("settings.relaySaved") : t("common.save")}
                  </button>
                  <button className="settings-action-btn" onClick={() => { resetRelayConfig(); setRelayHost(getRelayConfig().host); setRelayProtocol(getRelayConfig().protocol); setRelayError(""); setMsg(t("settings.relayReset")) }}>
                    {t("settings.relayReset")}
                  </button>
                </div>
                <p className="settings-info-text">{t("settings.relayRestart")}</p>
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

function ThemeSwatchButton({ id, label, checked, onSelect }: { id: Theme; label: string; checked: boolean; onSelect: () => void }) {
  const { customLight, customDark } = useTheme()
  // Превью кастомного скина: базовый data-theme + инлайн-переменные.
  const customVars = id === "custom-light" ? customLight : id === "custom-dark" ? customDark : null
  const previewTheme = isCustomSkinId(id) ? customSkinVariant(id) : id
  const previewStyle = customVars
    ? ({ "--bg": customVars.bg, "--surface-variant": customVars.surfaceVariant, "--msg-mine-bg": customVars.msgMineBg } as React.CSSProperties)
    : undefined
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`theme-swatch-btn ${checked ? "active" : ""}`}
      onClick={onSelect}
    >
      <span className="theme-swatch" data-theme={previewTheme} style={previewStyle}>
        <span className="theme-swatch-bubble theirs" />
        <span className="theme-swatch-bubble mine" />
      </span>
      <span className="theme-swatch-label">{label}</span>
    </button>
  )
}
