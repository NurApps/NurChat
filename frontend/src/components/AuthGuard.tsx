import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { hasSession, writeStoredUserRaw } from "../services/tokenVault"
import { isPinEnabled } from "../services/pinLock"
import { performLogout } from "../services/localSession"
import { useChatStore } from "../store/chatStore"
import PinLock from "./PinLock"

interface Props {
  children: React.ReactNode
}

export default function AuthGuard({ children }: Props) {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    if (!hasSession()) {
      navigate("/login", { replace: true })
      return
    }
    api.getCurrentUser()
      .then((user) => {
        writeStoredUserRaw(JSON.stringify(user))
        useChatStore.getState().refreshCurrentUser()
        if (isPinEnabled()) {
          setLocked(true)
        }
        setChecking(false)
      })
      .catch((err) => {
        // Сессию гасим только при настоящем отказе в авторизации (401/403 после
        // неудачного refresh). Сеть, 429 (rate limit), 5xx — временные: токен
        // остаётся, иначе любая перезагрузка (HMR, F5) при лимите выкидывает из аккаунта.
        const status = (err as { status?: unknown } | null)?.status
        if (status === 401 || status === 403) {
          performLogout()
          navigate("/login", { replace: true })
        } else {
          console.warn("[AuthGuard] Transient error, keeping token:", err)
          setChecking(false)
        }
      })
  }, [navigate])

  if (checking) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (locked) {
    return <PinLock onUnlock={() => setLocked(false)} />
  }

  return <>{children}</>
}
