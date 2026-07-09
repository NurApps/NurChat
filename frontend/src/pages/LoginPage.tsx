import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { saveKeys as saveE2EKeys } from "../services/e2e"

const TG_BLUE = "#2AABEE"

export default function LoginPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

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
        navigate("/chat", { replace: true })
      })
      .catch(() => {
        api.clearToken()
        setChecking(false)
      })
  }, [navigate])

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login")
    setError("")
  }

  const validate = (): boolean => {
    if (!username.trim()) { setError("Введите username"); return false }
    if (username.trim().length < 3) { setError("Username минимум 3 символа"); return false }
    if (!/^[a-zA-Z0-9]+$/.test(username.trim())) { setError("Только латинские буквы и цифры"); return false }
    if (mode === "register") {
      if (!firstName.trim()) { setError("Введите имя"); return false }
      if (firstName.trim().length < 2) { setError("Имя минимум 2 символа"); return false }
    }
    if (!password) { setError("Введите пароль"); return false }
    if (password.length < 4) { setError("Пароль минимум 4 символа"); return false }
    return true
  }

  const handleSubmit = async () => {
    setError("")
    if (!validate()) return
    setLoading(true)

    try {
      if (mode === "login") {
        const res = await api.login(username.trim(), password)
        api.setToken(res.access_token)
        localStorage.setItem("user", JSON.stringify(res.user))
        // Restore E2E keys from localStorage if available (set during register)
        // If not available, keys will be generated via P2PStatusPage
        navigate("/chat", { replace: true })
      } else {
        const res = await api.register(username.trim(), password, firstName.trim(), lastName.trim())
        api.setToken(res.access_token)
        localStorage.setItem("user", JSON.stringify(res.user))
        // Save E2E keys on registration (private keys returned once)
        if (res.private_key && res.signing_private_key && res.user) {
          saveE2EKeys({
            privateKeyHex: res.private_key,
            publicKeyHex: res.user.public_key || "",
            signingPrivateHex: res.signing_private_key,
            signingPublicHex: res.user.signing_public_key || "",
          })
        }
        navigate("/chat", { replace: true })
      }
    } catch (err: any) {
      const msg = err?.message || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("ERR_NETWORK")) {
        setError("Сервер недоступен. Перезапустите приложение или проверьте подключение")
      } else if (err instanceof Error && "status" in err) {
        const apiErr = err as { status: number; message: string }
        if (apiErr.status === 401) setError("Неверный username или пароль")
        else if (apiErr.status === 409) setError("Username уже занят")
        else setError(apiErr.message || "Ошибка сервера")
      } else {
        setError("Ошибка подключения к серверу")
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

  const isRegister = mode === "register"

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
          <p className="login-subtitle">Анонимный исламский мессенджер</p>
        </div>

        {/* Поля */}
        <div className="login-fields">
          {isRegister && (
            <>
              <div className="field-wrapper">
                <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  className="login-input"
                  type="text"
                  placeholder="Имя *"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="field-wrapper">
                <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  className="login-input"
                  type="text"
                  placeholder="Фамилия (необязательно)"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="field-wrapper">
            <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <input
              className="login-input"
              type="text"
              placeholder={isRegister ? "Придумайте username (мин. 3 символа)" : "Введите username"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="field-wrapper">
            <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              className="login-input"
              type={showPassword ? "text" : "password"}
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              type="button"
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && <p className="login-error">{error}</p>}

        {/* Кнопки */}
        <div className="login-actions">
          <button
            className="login-btn"
            disabled={loading}
            onClick={handleSubmit}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                {isRegister ? "Регистрация..." : "Вход..."}
              </span>
            ) : (
              <span className="btn-content">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isRegister ? (
                    <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><polyline points="17 8 21 12 17 16" /><line x1="21" y1="12" x2="9" y2="12" /></>
                  ) : (
                    <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></>
                  )}
                </svg>
                {isRegister ? "Зарегистрироваться" : "Войти"}
              </span>
            )}
          </button>

          <button className="switch-mode-btn" onClick={toggleMode}>
            {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
          </button>
        </div>

        {/* Разделитель */}
        <div className="login-divider">
          <span className="divider-line" />
          <span className="divider-text">или</span>
          <span className="divider-line" />
        </div>

        {/* Ссылки */}
        <div className="login-links">
          <div className="links-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Безопасность и приватность</span>
          </div>
          <div className="links-row secondary">
            <button className="link-btn">Политика конфиденциальности</button>
            <span className="dot">•</span>
            <button className="link-btn">Пользовательское соглашение</button>
          </div>
        </div>

        {/* Подсказка */}
        <div className="login-hint">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p>
            Ваши данные защищены end-to-end шифрованием.
            <br />
            Имя будет видно другим пользователям.
          </p>
        </div>
      </div>
    </div>
  )
}
