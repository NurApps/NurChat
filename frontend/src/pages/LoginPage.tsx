import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { BASE_URL } from "../config"
import { loadKeys, setupPreKeys } from "../services/e2e"

const TG_BLUE = "#2AABEE"

type Tab = "register" | "login"

export default function LoginPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<Tab>("register")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Register fields
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirm, setPasswordConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  // Login fields
  const [loginUsername, setLoginUsername] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  // CAPTCHA
  const [captchaId, setCaptchaId] = useState("")
  const [captchaQuestion, setCaptchaQuestion] = useState("")
  const [captchaAnswer, setCaptchaAnswer] = useState("")

  // Auto-login
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

  // Load CAPTCHA when tab is register
  useEffect(() => {
    if (tab === "register") fetchCaptcha()
  }, [tab])

  const fetchCaptcha = async () => {
    try {
      const res = await api.getCaptcha()
      setCaptchaId(res.captcha_id)
      setCaptchaQuestion(res.question)
      setCaptchaAnswer("")
    } catch {
      setCaptchaQuestion("Загрузка CAPTCHA...")
    }
  }

  const handleRegister = async () => {
    setError("")
    if (!firstName.trim() || firstName.trim().length < 2) {
      setError("Имя должно содержать минимум 2 символа")
      return
    }
    if (!username.trim()) {
      setError("Введите username")
      return
    }
    if (password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов")
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError("Пароль должен содержать заглавную латинскую букву")
      return
    }
    if (!/[a-z]/.test(password)) {
      setError("Пароль должен содержать строчную латинскую букву")
      return
    }
    if (!/\d/.test(password)) {
      setError("Пароль должен содержать хотя бы одну цифру")
      return
    }
    if (password !== passwordConfirm) {
      setError("Пароли не совпадают")
      return
    }
    if (!captchaAnswer.trim()) {
      setError("Решите CAPTCHA")
      return
    }

    setLoading(true)
    try {
      const res = await api.register(
        username.trim(),
        password,
        firstName.trim(),
        lastName.trim(),
        captchaId,
        captchaAnswer.trim()
      )
      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))

      // Save E2E keys if server returned them
      if (res.private_key) {
        const pubHex = res.user.public_key || ""
        const signPub = res.user.signing_public_key || ""
        saveKeys({
          privateKeyHex: res.private_key,
          publicKeyHex: pubHex,
          signingPrivateHex: res.signing_private_key || "",
          signingPublicHex: signPub,
        })
        const keys = loadKeys()
        if (keys) setupPreKeys(keys).catch(() => {})
      }

      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED")) {
        setError(`Relay недоступен: ${BASE_URL}`)
      } else if (msg.includes("CAPTCHA")) {
        setError("Неверная CAPTCHA")
        fetchCaptcha()
      } else {
        setError(msg || "Ошибка регистрации")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    setError("")
    if (!loginUsername.trim() || !loginPassword) {
      setError("Заполните все поля")
      return
    }

    setLoading(true)
    try {
      const res = await api.login(loginUsername.trim(), loginPassword)
      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))
      const keys = loadKeys()
      if (keys) setupPreKeys(keys).catch(() => {})
      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED")) {
        setError(`Relay недоступен: ${BASE_URL}`)
      } else {
        setError(msg || "Неверный username или пароль")
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
        <div className="login-logo">
          <div className="logo-circle">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={TG_BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="login-title">NurChat</h1>
          <p className="login-subtitle">Безопасный мессенджер с E2E-шифрованием</p>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); setError("") }}
          >
            Регистрация
          </button>
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); setError("") }}
          >
            Вход
          </button>
        </div>

        {tab === "register" ? (
          <div className="login-fields">
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
            <div className="field-wrapper">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
              <input
                className="login-input"
                type="text"
                placeholder="Username *"
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
                placeholder="Пароль * (8+ символов, A-Z, a-z, 0-9)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showPassword
                    ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                    : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                  }
                </svg>
              </button>
            </div>
            <div className="field-wrapper">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                className="login-input"
                type={showPassword ? "text" : "password"}
                placeholder="Повторите пароль *"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </div>

            {/* CAPTCHA */}
            {captchaQuestion && (
              <div className="captcha-block">
                <label className="captcha-label">{captchaQuestion} =</label>
                <input
                  className="login-input captcha-input"
                  type="text"
                  placeholder="Ответ"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                />
                <button className="link-btn captcha-refresh" onClick={fetchCaptcha} type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="login-fields">
            <div className="field-wrapper">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
              <input
                className="login-input"
                type="text"
                placeholder="Username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
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
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
              <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showPassword
                    ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                    : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                  }
                </svg>
              </button>
            </div>
          </div>
        )}

        {error && <p className="login-error">{error}</p>}

        <div className="login-actions">
          <button
            className="login-btn"
            disabled={loading}
            onClick={tab === "register" ? handleRegister : handleLogin}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                {tab === "register" ? "Регистрация..." : "Вход..."}
              </span>
            ) : (
              <span className="btn-content">
                {tab === "register" ? "Зарегистрироваться" : "Войти"}
              </span>
            )}
          </button>
        </div>

        <div className="login-links">
          <div className="links-row secondary">
            <span style={{ fontSize: 12, opacity: 0.7 }}>Relay: {BASE_URL}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
