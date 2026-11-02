import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { hasSession, vaultReady, writeStoredUserRaw } from "../services/tokenVault"
import { isPinEnabled } from "../services/pinLock"
import { initSecureStorage } from "../services/e2e"
import { performLogout } from "../services/localSession"
import { useChatStore } from "../store/chatStore"
import PinLock from "./PinLock"

interface Props {
  children: React.ReactNode
}

// Сессия уже подтверждена сервером в этом запуске. У каждого маршрута свой
// экземпляр AuthGuard, и без этого флага каждый переход (например, в настройки)
// заново ждал сетевой getCurrentUser() под полноэкранным спиннером — на медленном
// релее это 0,5–1 с белого экрана. Проверка при этом всё равно идёт в фоне.
let sessionVerified = false

export default function AuthGuard({ children }: Props) {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(!(sessionVerified && hasSession()))
  const [locked, setLocked] = useState(false)

  // initSecureStorage at boot is a no-op while PIN-locked (anti-clobber);
  // the deferred init runs here, after unlockWithPin() restored the key.
  const handleUnlock = async () => {
    try {
      await initSecureStorage()
    } catch (err) {
      console.error("[AuthGuard] Secure storage init after unlock failed:", err)
    }
    setLocked(false)
  }

  useEffect(() => {
    // Vault unlock is async (IndexedDB): without waiting, a reload with a
    // persisted-but-not-yet-decrypted refresh reads as "no session".
    vaultReady.then(() => {
      if (!hasSession()) {
        navigate("/login", { replace: true })
        return
      }
      api.getCurrentUser()
      .then((user) => {
        sessionVerified = true
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
          sessionVerified = false
          performLogout()
          navigate("/login", { replace: true })
        } else {
          console.warn("[AuthGuard] Transient error, keeping token:", err)
          setChecking(false)
        }
      })
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
    return <PinLock onUnlock={handleUnlock} />
  }

  return <>{children}</>
}
