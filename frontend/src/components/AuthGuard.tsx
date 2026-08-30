import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { isPinEnabled } from "../services/pinLock"
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
    const token = localStorage.getItem("token")
    if (!token) {
      navigate("/login", { replace: true })
      return
    }
    api.getCurrentUser()
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user))
        useChatStore.getState().refreshCurrentUser()
        if (isPinEnabled()) {
          setLocked(true)
        }
        setChecking(false)
      })
      .catch((err) => {
        // Distinguish network errors from auth errors
        const isNetworkError = err instanceof TypeError
          || err?.message?.includes("Failed to fetch")
          || err?.message?.includes("NetworkError")
          || err?.status === 0
          || !navigator.onLine

        if (isNetworkError) {
          // Network error — don't destroy token, just show error and let user retry
          console.warn("[AuthGuard] Network error, keeping token:", err)
          setChecking(false)
        } else {
          // Auth error (401, 403, etc.) — token is invalid
          api.clearToken()
          navigate("/login", { replace: true })
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
