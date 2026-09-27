import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import ProfileEditor from "../components/ProfileEditor"
import type { UserResponse } from "../types"
import { ArrowLeft } from "lucide-react"

/** Отдельная страница профиля (/profile). Та же форма встроена во вкладку «Профиль» настроек. */
export default function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [user, setUser] = useState<UserResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const dirtyRef = useRef(false)

  // 401 обрабатывается глобально в api.request (refresh → AuthExpiredListener → /login),
  // поэтому любая ошибка здесь — не «вылогинить», а показать состояние с повтором.
  const load = () => {
    setLoadError(false)
    api.getCurrentUser()
      .then((u: UserResponse) => setUser(u))
      .catch(() => setLoadError(true))
  }
  useEffect(load, [])

  const goBack = () => {
    if (dirtyRef.current && !confirm(t("profile.discardChanges"))) return
    navigate("/chat")
  }

  if (loadError) {
    return (
      <div className="auth-loading">
        <p className="settings-msg err" role="alert">{t("errors.network")}</p>
        <button type="button" className="avatar-btn" onClick={load}>{t("common.retry")}</button>
      </div>
    )
  }
  if (!user) return <div className="auth-loading"><div className="spinner" /></div>

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button type="button" className="settings-back" onClick={goBack} aria-label={t("common.back")}>
          <ArrowLeft size={24} strokeWidth={2} aria-hidden="true" />
        </button>
        <h2>{t("profile.title")}</h2>
      </div>

      <div className="settings-body">
        <div className="settings-content">
          <ProfileEditor user={user} onUserChange={setUser} onDirtyChange={(d) => { dirtyRef.current = d }} />
        </div>
      </div>
    </div>
  )
}
