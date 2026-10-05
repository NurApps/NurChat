import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { isPasskeySupported, registerPasskey, type PasskeyCredential } from "../services/webauthn"

/**
 * Passkeys в профиле: список, привязка нового (церемония браузера),
 * удаление (с паролем). Неподдерживаемый браузер — честная заглушка.
 */
export default function PasskeyManager() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<PasskeyCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [delPassword, setDelPassword] = useState("")
  const [delId, setDelId] = useState<number | null>(null)
  const [err, setErr] = useState("")
  const [msg, setMsg] = useState("")
  const supported = isPasskeySupported()

  const reload = async () => {
    try {
      const res = await api.webauthnList()
      setKeys(res.credentials)
    } catch {
      setErr(t("settings.passkeyLoadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fail = (e: unknown, fallback: string) => {
    const m = e instanceof Error ? e.message : ""
    if (m === "ceremony-cancelled") setErr(t("settings.passkeyCancelled"))
    else if (m === "NotAllowedError" || (e as { name?: string })?.name === "NotAllowedError") {
      setErr(t("settings.passkeyCancelled"))
    } else {
      const text = typeof (e as { message?: unknown })?.message === "string"
        ? (e as { message: string }).message
        : fallback
      setErr(text.includes("Origin") || text.includes("хост") ? text : fallback)
    }
  }

  const handleAdd = async () => {
    setErr("")
    setMsg("")
    setBusy(true)
    try {
      const created = await registerPasskey(name.trim())
      setName("")
      setKeys((prev) => [...prev, created])
      setMsg(t("settings.passkeyAdded"))
    } catch (e) {
      fail(e, t("settings.passkeyAddFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (delPassword.length < 1) {
      setErr(t("settings.passkeyNeedPassword"))
      return
    }
    setErr("")
    setMsg("")
    setBusy(true)
    try {
      await api.webauthnDelete(id, delPassword)
      setDelPassword("")
      setDelId(null)
      setKeys((prev) => prev.filter((k) => k.id !== id))
      setMsg(t("settings.passkeyDeleted"))
    } catch {
      setErr(t("settings.passkeyDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return <p className="settings-info-text">{t("settings.passkeyUnsupported")}</p>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {loading && <p className="settings-info-text">{t("settings.loadingInfo")}</p>}
      {keys.map((k) => (
        <div key={k.id} className="settings-field-row">
          <span className="settings-field-label">{k.name || t("settings.passkeyUnnamed")}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {delId === k.id ? (
              <>
                <input
                  type="password"
                  className="settings-input"
                  style={{ width: 140 }}
                  autoComplete="current-password"
                  placeholder={t("settings.totpPasswordPlaceholder")}
                  value={delPassword}
                  onChange={(e) => setDelPassword(e.target.value)}
                />
                <button type="button" className="settings-action-btn danger" disabled={busy} onClick={() => void handleDelete(k.id)}>
                  {t("settings.passkeyConfirmDelete")}
                </button>
              </>
            ) : (
              <button type="button" className="settings-action-btn danger" onClick={() => { setDelId(k.id); setDelPassword(""); setErr(""); setMsg("") }}>
                {t("settings.passkeyDelete")}
              </button>
            )}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <input
          type="text"
          className="settings-input"
          style={{ flex: 1 }}
          maxLength={64}
          placeholder={t("settings.passkeyNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void handleAdd()}>
          {t("settings.passkeyAdd")}
        </button>
      </div>
      {(msg || err) && (
        <p className="settings-info-text" style={{ color: err ? "var(--error)" : "var(--success)" }}>
          {err || msg}
        </p>
      )}
    </div>
  )
}
