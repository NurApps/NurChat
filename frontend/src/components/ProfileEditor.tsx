import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api, apiErrorMessage } from "../services/api"
import { useAvatar } from "../hooks/useAvatar"
import { formatDateShort } from "../utils/format"
import ProfileAvatar from "./ProfileAvatar"
import type { UserResponse } from "../types"

// Совпадает с ограничениями сервера (server/routes/auth.py: update_profile).
const NAME_MIN = 2
const NAME_MAX = 64
const STATUS_MAX = 100
const BIO_MAX = 500

interface Props {
  user: UserResponse
  onUserChange: (user: UserResponse) => void
  /** Есть несохранённые правки — настройки спрашивают перед уходом. */
  onDirtyChange?: (dirty: boolean) => void
  /** Сразу открыть форму редактирования при показе. */
  autoEdit?: boolean
}

/** Профиль: просмотр и редактирование на месте. Вкладка «Профиль» настроек. */
export default function ProfileEditor({ user, onUserChange, onDirtyChange, autoEdit }: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [status, setStatus] = useState("")
  const [bio, setBio] = useState("")
  const { uploading, msg, msgKind, setMsg, setOk, setErr, uploadAvatar, deleteAvatar } = useAvatar(onUserChange)

  const startEdit = () => {
    setFirstName(user.first_name || "")
    setLastName(user.last_name || "")
    setStatus(user.status || "")
    setBio(user.bio || "")
    setMsg("")
    setEditing(true)
  }

  useEffect(() => { if (autoEdit) startEdit() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cancelEdit = () => {
    setEditing(false)
    setMsg("")
  }

  const firstNameTrimmed = firstName.trim()
  const firstNameInvalid = firstNameTrimmed.length < NAME_MIN
  const dirty = editing && (
    firstNameTrimmed !== (user.first_name || "") ||
    lastName.trim() !== (user.last_name || "") ||
    status !== (user.status || "") ||
    bio !== (user.bio || "")
  )

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  // Не теряем правки молча при закрытии окна/вкладки.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (firstNameInvalid) return setErr(t("profile.firstNameTooShort", { min: NAME_MIN }))
    setSaving(true)
    setMsg("")
    try {
      const updated = await api.updateProfile({
        first_name: firstNameTrimmed,
        last_name: lastName.trim(),
        status: status.trim(),
        bio: bio.trim(),
      })
      onUserChange(updated)
      setEditing(false)
      setOk(t("settings.saved"))
    } catch (err) {
      setErr(apiErrorMessage(err, t("settings.error")))
    } finally {
      setSaving(false)
    }
  }

  const notice = msg && <p className={`settings-msg ${msgKind === "err" ? "err" : "ok"}`} role="status" aria-live="polite">{msg}</p>

  return (
    <>
      <ProfileAvatar user={user} uploading={uploading} onUpload={uploadAvatar} onDelete={deleteAvatar} onInvalid={setErr} />

      {editing ? (
        <form onSubmit={handleSave} noValidate>
          <div className="settings-fields">
            <label className="settings-label" htmlFor="pf-first">{t("profile.firstName")}</label>
            <input id="pf-first" className="settings-input" value={firstName} maxLength={NAME_MAX} autoComplete="given-name"
              aria-invalid={firstNameInvalid} onChange={(e) => setFirstName(e.target.value)} />

            <label className="settings-label" htmlFor="pf-last">{t("profile.lastName")}</label>
            <input id="pf-last" className="settings-input" value={lastName} maxLength={NAME_MAX} autoComplete="family-name"
              onChange={(e) => setLastName(e.target.value)} />

            <label className="settings-label" htmlFor="pf-status">{t("profile.status")}</label>
            <input id="pf-status" className="settings-input" value={status} maxLength={STATUS_MAX}
              placeholder={t("settings.statusPlaceholder")} onChange={(e) => setStatus(e.target.value)} />

            <label className="settings-label" htmlFor="pf-bio">{t("profile.bio")}</label>
            <textarea id="pf-bio" className="settings-textarea" rows={3} value={bio} maxLength={BIO_MAX}
              placeholder={t("settings.bioPlaceholder")} onChange={(e) => setBio(e.target.value)} />
            <span className="settings-userid profile-bio-counter" aria-hidden="true">{bio.length}/{BIO_MAX}</span>
          </div>

          {notice}

          <div className="profile-edit-actions">
            <button type="button" className="avatar-btn" onClick={cancelEdit} disabled={saving}>{t("common.cancel")}</button>
            <button type="submit" className="settings-save-btn" disabled={saving || !dirty || firstNameInvalid}>
              {saving ? t("settings.saving") : t("common.save")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="settings-fields">
            <div className="profile-field">
              <span className="profile-field-label">{t("profile.firstName")}</span>
              <span className="profile-field-value">{user.first_name || "—"}</span>
            </div>
            <div className="profile-field">
              <span className="profile-field-label">{t("profile.lastName")}</span>
              <span className="profile-field-value">{user.last_name || "—"}</span>
            </div>
            <div className="profile-field">
              <span className="profile-field-label">{t("profile.status")}</span>
              <span className="profile-field-value">{user.status || "—"}</span>
            </div>
            <div className="profile-field">
              <span className="profile-field-label">{t("profile.bio")}</span>
              <span className="profile-field-value">{user.bio || "—"}</span>
            </div>
            <div className="profile-field">
              <span className="profile-field-label">{t("profile.registeredAt")}</span>
              <span className="profile-field-value">{user.created_at ? formatDateShort(user.created_at) : "—"}</span>
            </div>
          </div>

          {notice}

          <button type="button" className="settings-save-btn profile-edit-btn" onClick={startEdit}>
            {t("profile.editProfile")}
          </button>
        </>
      )}
    </>
  )
}
