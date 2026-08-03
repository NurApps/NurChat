import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { BASE_URL } from "../config"
import { loadKeys, generateKeys, saveKeys, hasKeys, setupPreKeys } from "../services/e2e"

const TG_BLUE = "#2AABEE"

export default function LoginPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [displayName, setDisplayName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [isNewIdentity, setIsNewIdentity] = useState(false)

  // Auto-login: если токен есть и валиден — сразу в чат
  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) {
      setChecking(false)
      return
    }
    api.getCurrentUser()
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user))
        const keys = loadKeys()
        if (keys) setupPreKeys(keys).catch(() => {})
        navigate("/chat", { replace: true })
      })
      .catch(() => {
        api.clearToken()
        setChecking(false)
      })
  }, [navigate])

  // Если нет ни токена, ни ключей — создаём анонимную идентичность
  useEffect(() => {
    if (checking) return
    if (!hasKeys()) {
      const keys = generateKeys()
      saveKeys(keys)
      setIsNewIdentity(true)
    }
  }, [checking])

  const handleConnect = async () => {
    setError("")
    setLoading(true)
    try {
      let keys = loadKeys()
      if (!keys) {
        keys = generateKeys()
        saveKeys(keys)
        setIsNewIdentity(true)
      }
      const res = await api.registerAnonymous(keys.publicKeyHex, keys.signingPublicHex, displayName.trim() || undefined)
      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))
      setupPreKeys(keys).catch(() => {})
      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("ERR_NETWORK") || msg.includes("request failed") || msg.includes("error sending request")) {
        setError(`Relay недоступен: ${BASE_URL}. Проверьте подключение к интернету или адрес relay.`)
      } else {
        setError(msg || "Ошибка подключения к relay")
      }
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Логотип */}
        <div className="login-logo">
          <div className="logo-circle">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={TG_BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="login-title">NurChat</h1>
          <p className="login-subtitle">Анонимный мессенджер. E2E-шифрование через relay</p>
        </div>

        {isNewIdentity && (
          <div className="login-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p>
              Создана новая анонимная идентичность.
              <br />
              Ключи хранятся только на этом устройстве. Никаких паролей.
            </p>
          </div>
        )}

        {/* Имя (необязательно, хранится на relay как подпись) */}
        <div className="login-fields">
          <div className="field-wrapper">
            <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <input
              className="login-input"
              type="text"
              placeholder="Имя (необязательно)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="login-error">{error}</p>}

        {/* Кнопка */}
        <div className="login-actions">
          <button
            className="login-btn"
            disabled={loading}
            onClick={handleConnect}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                Подключение...
              </span>
            ) : (
              <span className="btn-content">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
                Подключиться
              </span>
            )}
          </button>
        </div>

        {/* Адрес relay */}
        <div className="login-links">
          <div className="links-row secondary">
            <span style={{ fontSize: 12, opacity: 0.7 }}>Relay: {BASE_URL}</span>
          </div>
          <div className="links-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Безопасность и приватность</span>
          </div>
        </div>

        {/* Подсказка */}
        <div className="login-hint">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p>
            Сообщения защищены end-to-end шифрованием.
            <br />
            Relay хранит только зашифрованные блобы и не может прочитать содержимое.
          </p>
        </div>
      </div>
    </div>
  )
}
