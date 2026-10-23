import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Check, Copy, Globe } from "lucide-react"
import {
  enableInviteOnly,
  getCloudflaredPath,
  getHostAutostart,
  getHostStatus,
  getLocalPolicy,
  hostModeSupported,
  localRelayHealthy,
  onHostStatus,
  openRegistration,
  setCloudflaredPath,
  setHostAutostart,
  startHost,
  stopHost,
  type HostPolicy,
  type HostStatus,
} from "../services/hostMode"
import { platform } from "../services/platform"
import { setRelayConfig } from "../config"

const CLOUDFLARED_RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest"

interface Props {
  compact?: boolean
}

export default function HostModePanel({ compact = false }: Props) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<HostStatus>({ state: "stopped" })
  const [policy, setPolicy] = useState<HostPolicy | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [autostart, setAutostart] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState("")
  const [cfOpen, setCfOpen] = useState(false)
  const [cfPath, setCfPath] = useState<string | null>(null)
  const [cfInput, setCfInput] = useState("")
  const [cfBusy, setCfBusy] = useState(false)
  const [cfMsg, setCfMsg] = useState("")
  const [cfError, setCfError] = useState(false)
  const inviteAppliedRef = useRef<string | null>(null)

  const refreshLocal = useCallback(async () => {
    const ok = await localRelayHealthy()
    setReachable(ok)
    if (!ok) {
      setPolicy(null)
      return
    }
    try {
      setPolicy(await getLocalPolicy())
    } catch {
      setPolicy(null)
    }
  }, [])

  useEffect(() => {
    if (!hostModeSupported()) return
    getHostStatus().then(setStatus).catch(() => {})
    getHostAutostart().then(setAutostart).catch(() => {})
    getCloudflaredPath().then((path) => {
      setCfPath(path)
      setCfInput(path ?? "")
    }).catch(() => {})
    refreshLocal()
    let unlisten: (() => void) | undefined
    onHostStatus(setStatus).then((fn) => { unlisten = fn }).catch(() => {})
    return () => { unlisten?.() }
  }, [refreshLocal])

  // Ошибка запуска почти всегда = cloudflared не найден: сразу показываем
  // ручной путь, чтобы не заставлять пользователя искать настройку.
  useEffect(() => {
    if (status.state === "error") setCfOpen(true)
  }, [status.state])

  // Первый переход в ready: закрываем регистрацию и показываем код.
  useEffect(() => {
    if (status.state !== "ready" || !status.url) return
    if (inviteAppliedRef.current === status.url) return
    inviteAppliedRef.current = status.url
    enableInviteOnly().then(setPolicy).catch(() => {})
  }, [status.state, status.url])

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(""), 1500)
    } catch {
      setError(t("hostMode.copyFailed"))
    }
  }

  const handleStart = async () => {
    setError("")
    setBusy(true)
    const ok = await localRelayHealthy()
    setReachable(ok)
    if (!ok) {
      setError(t("hostMode.needLocalRelay"))
      setBusy(false)
      return
    }
    try {
      setStatus(await startHost())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const handleStop = async () => {
    setError("")
    setBusy(true)
    try {
      await stopHost()
      setStatus({ state: "stopped" })
      inviteAppliedRef.current = null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const handleAutostart = async (enabled: boolean) => {
    setAutostart(enabled)
    try {
      await setHostAutostart(enabled)
    } catch {
      setAutostart(!enabled)
    }
  }

  const saveCloudflared = async () => {
    setCfBusy(true)
    setCfMsg("")
    setCfError(false)
    try {
      const value = cfInput.trim()
      await setCloudflaredPath(value || null)
      setCfPath(value || null)
      setCfMsg(t("hostMode.cloudflaredSaved"))
    } catch (e) {
      setCfError(true)
      setCfMsg(e instanceof Error ? e.message : String(e))
    }
    setCfBusy(false)
  }

  const resetCloudflared = async () => {
    setCfBusy(true)
    setCfMsg("")
    setCfError(false)
    try {
      await setCloudflaredPath(null)
      setCfPath(null)
      setCfInput("")
      setCfMsg(t("hostMode.cloudflaredResetDone"))
    } catch (e) {
      setCfError(true)
      setCfMsg(e instanceof Error ? e.message : String(e))
    }
    setCfBusy(false)
  }

  const toggleInvite = async (inviteOnly: boolean) => {
    setError("")
    try {
      setPolicy(inviteOnly ? await enableInviteOnly() : await openRegistration())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const switchToHost = () => {
    if (!status.url) return
    const host = status.url.replace(/^https?:\/\//, "")
    if (!window.confirm(t("hostMode.switchConfirm", { host }))) return
    setRelayConfig({ host, protocol: "https" })
    window.location.reload()
  }

  if (!hostModeSupported()) {
    return <p className="settings-info-text">{t("hostMode.desktopOnly")}</p>
  }

  const running = ["downloading", "starting", "restarting", "ready"].includes(status.state)
  const statusLabel = t(`hostMode.state.${status.state}`)
  const inviteLink = status.url
    ? `${t("hostMode.inviteText")}\n${status.url}${policy?.invite_code ? `\n${t("hostMode.inviteCode")}: ${policy.invite_code}` : ""}`
    : ""

  return (
    <div className={compact ? "" : "settings-group"}>
      {!compact && <h3 className="settings-group-title">{t("hostMode.title")}</h3>}
      <p className="settings-info-text">{t("hostMode.desc")}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }}>
        <Globe size={16} aria-hidden="true" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("hostMode.status")}:</span>
        <span style={{ fontSize: 13, color: status.state === "error" ? "var(--error)" : "var(--text-secondary)" }}>
          {statusLabel}
        </span>
      </div>

      {reachable === false && (
        <p style={{ color: "var(--error)", fontSize: 13, margin: "0 0 10px" }}>
          {t("hostMode.localRelayDown")}
        </p>
      )}

      {status.state === "error" && status.error && (
        <p style={{ color: "var(--error)", fontSize: 13, margin: "0 0 10px", wordBreak: "break-word" }}>
          {status.error}
        </p>
      )}

      {error && (
        <p style={{ color: "var(--error)", fontSize: 13, margin: "0 0 10px", wordBreak: "break-word" }}>
          {error}
        </p>
      )}

      {running ? (
        <button className="settings-action-btn danger" onClick={handleStop} disabled={busy}>
          {t("hostMode.stop")}
        </button>
      ) : (
        <button className="settings-save-btn" onClick={handleStart} disabled={busy || reachable === false} style={{ width: "auto", padding: "0 16px", height: 40 }}>
          {busy ? t("hostMode.starting") : t("hostMode.start")}
        </button>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => handleAutostart(e.target.checked)}
        />
        {t("hostMode.autostart")}
      </label>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="settings-action-btn"
          style={{ width: "auto", padding: "0 12px" }}
          onClick={() => setCfOpen((open) => !open)}
        >
          {t("hostMode.cloudflaredToggle")}
        </button>

        {cfOpen && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="settings-info-text" style={{ margin: 0 }}>
              {t("hostMode.cloudflaredHint")}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="settings-action-btn"
                style={{ width: "auto", padding: "0 12px" }}
                onClick={() => platform.openExternal(CLOUDFLARED_RELEASES)}
              >
                {t("hostMode.cloudflaredDownload")}
              </button>
            </div>
            <input
              className="settings-input"
              type="text"
              value={cfInput}
              onChange={(e) => { setCfInput(e.target.value); setCfMsg(""); setCfError(false) }}
              placeholder={t("hostMode.cloudflaredPathPlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="settings-action-btn"
                style={{ width: "auto", padding: "0 12px" }}
                onClick={saveCloudflared}
                disabled={cfBusy}
              >
                {t("hostMode.cloudflaredSave")}
              </button>
              {cfPath && (
                <button
                  type="button"
                  className="settings-action-btn danger"
                  style={{ width: "auto", padding: "0 12px" }}
                  onClick={resetCloudflared}
                  disabled={cfBusy}
                >
                  {t("hostMode.cloudflaredReset")}
                </button>
              )}
            </div>
            {cfPath && (
              <p className="settings-info-text" style={{ margin: 0 }}>
                {t("hostMode.cloudflaredCurrent", { path: cfPath })}
              </p>
            )}
            {cfMsg && (
              <p className="settings-info-text" style={{ margin: 0, color: cfError ? "var(--error)" : "var(--success)" }}>
                {cfMsg}
              </p>
            )}
          </div>
        )}
      </div>

      {status.state === "ready" && status.url && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="settings-field-row" style={{ alignItems: "center", gap: 8 }}>
            <span className="settings-field-label">{t("hostMode.address")}</span>
            <code style={{ fontSize: 12, wordBreak: "break-all" }}>{status.url}</code>
            <button className="settings-action-btn" onClick={() => copy(status.url!, "url")} style={{ width: "auto", padding: "4px 8px" }}>
              {copied === "url" ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>

          <div className="settings-field-row" style={{ alignItems: "center", gap: 8 }}>
            <span className="settings-field-label">{t("hostMode.registration")}</span>
            <span style={{ fontSize: 13 }}>
              {policy?.invite_only ? t("hostMode.registrationClosed") : t("hostMode.registrationOpen")}
            </span>
            <button
              className="settings-action-btn"
              onClick={() => toggleInvite(!policy?.invite_only)}
              style={{ width: "auto", padding: "4px 8px" }}
            >
              {policy?.invite_only ? t("hostMode.openRegistration") : t("hostMode.closeRegistration")}
            </button>
          </div>

          {policy?.invite_only && policy.invite_code && (
            <div className="settings-field-row" style={{ alignItems: "center", gap: 8 }}>
              <span className="settings-field-label">{t("hostMode.inviteCode")}</span>
              <code style={{ fontSize: 14, letterSpacing: 1 }}>{policy.invite_code}</code>
              <button className="settings-action-btn" onClick={() => copy(policy.invite_code!, "code")} style={{ width: "auto", padding: "4px 8px" }}>
                {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="settings-action-btn" onClick={() => copy(inviteLink, "invite")} style={{ width: "auto", padding: "0 12px" }}>
              {copied === "invite" ? t("hostMode.copied") : t("hostMode.copyInvite")}
            </button>
            <button className="settings-action-btn" onClick={switchToHost} style={{ width: "auto", padding: "0 12px" }}>
              {t("hostMode.useThisRelay")}
            </button>
          </div>

          <p style={{ display: "flex", gap: 6, fontSize: 12, opacity: 0.75, margin: 0 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            {t("hostMode.temporaryHint")}
          </p>
        </div>
      )}
    </div>
  )
}
