import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { BASE_URL } from "../config"
import { generateKeys, loadKeys, saveKeys, setupPreKeys } from "../services/e2e"

const TG_BLUE = "#2AABEE"

type Tab = "register" | "login"

export default function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<Tab>("register")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [serverUnavailable, setServerUnavailable] = useState(false)

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

  // 2FA
  const [awaiting2fa, setAwaiting2fa] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState("")

  // CAPTCHA
  const [captchaId, setCaptchaId] = useState("")
  const [captchaQuestion, setCaptchaQuestion] = useState("")
  const [captchaAnswer, setCaptchaAnswer] = useState("")

  // Auto-login or check server health
  useEffect(() => {
    const token = localStorage.getItem("token")
    if (token) {
      api.getCurrentUser()
        .then(async (user) => {
          localStorage.setItem("user", JSON.stringify(user))
          const keys = await loadKeys()
          if (keys) setupPreKeys(keys).catch(() => {})
          navigate("/chat", { replace: true })
        })
        .catch(() => {
          api.clearToken()
          setChecking(false)
        })
      return
    }
    // No token — check if server is reachable before showing register/login
    fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => {
        if (r.ok) setChecking(false)
        else setServerUnavailable(true), setChecking(false)
      })
      .catch(() => {
        setServerUnavailable(true)
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
      setCaptchaQuestion(t("auth.captchaLoading"))
    }
  }

  const handleRegister = async () => {
    setError("")
    if (!firstName.trim() || firstName.trim().length < 2) {
      setError(t("auth.firstNameMinLength"))
      return
    }
    if (!username.trim()) {
      setError(t("auth.enterUsername"))
      return
    }
    if (password.length < 8) {
      setError(t("auth.passwordMinLength"))
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError(t("auth.passwordUpperCase"))
      return
    }
    if (!/[a-z]/.test(password)) {
      setError(t("auth.passwordLowerCase"))
      return
    }
    if (!/\d/.test(password)) {
      setError(t("auth.passwordDigit"))
      return
    }
    if (password !== passwordConfirm) {
      setError(t("auth.passwordsMismatch"))
      return
    }
    if (!captchaAnswer.trim()) {
      setError(t("auth.solveCaptcha"))
      return
    }

    setLoading(true)
    try {
      // Identity keys are generated on the device; the private key never
      // leaves the browser (server rejects registrations without keys).
      const e2eKeys = await generateKeys()
      const res = await api.register(
        username.trim(),
        password,
        firstName.trim(),
        lastName.trim(),
        captchaId,
        captchaAnswer.trim(),
        e2eKeys.publicKeyHex,
        e2eKeys.signingPublicHex
      )
      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))

      // Persist identity keys locally (encrypted at rest)
      await saveKeys(e2eKeys)
      setupPreKeys(e2eKeys).catch(() => {})

      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED")) {
        setError(`${t("errors.network")}: ${BASE_URL}`)
      } else if (msg.includes("CAPTCHA")) {
        setError(t("auth.wrongCaptcha"))
        fetchCaptcha()
      } else {
        setError(msg || t("auth.registerError"))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    setError("")
    if (!loginUsername.trim() || !loginPassword) {
      setError(t("auth.fillAllFields"))
      return
    }

    setLoading(true)
    try {
      const res = await api.login(loginUsername.trim(), loginPassword)

      // 2FA enabled: keep the pending token and ask for the code instead of
      // navigating — the pending token does not grant API access.
      if (res.requires_2fa) {
        api.setToken(res.access_token)
        setAwaiting2fa(true)
        setError("")
        return
      }

      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))
      const keys = await loadKeys()
      if (keys) setupPreKeys(keys).catch(() => {})
      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION_REFUSED")) {
        setError(`${t("errors.network")}: ${BASE_URL}`)
      } else {
        setError(msg || t("auth.wrongCredentials"))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify2fa() {
    const code = twoFactorCode.trim()
    if (!code) {
      setError(t("auth.enter2faCode"))
      return
    }
    setLoading(true)
    try {
      const res = await api.verify2faLogin(code)
      api.setToken(res.access_token)
      localStorage.setItem("user", JSON.stringify(res.user))
      const keys = await loadKeys()
      if (keys) setupPreKeys(keys).catch(() => {})
      setAwaiting2fa(false)
      setTwoFactorCode("")
      navigate("/chat", { replace: true })
    } catch (err: any) {
      const msg = err?.message || err?.toString() || ""
      setError(msg.includes("Неверный код") ? t("auth.wrong2faCode") : (msg || t("auth.wrong2faCode")))
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

  if (serverUnavailable) {
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
            <p className="login-subtitle">{t("auth.subtitle")}</p>
          </div>
          <div className="auth-error-box">
            <p>{t("errors.serverUnavailable")}: {BASE_URL}</p>
            <button className="auth-btn" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </button>
          </div>
        </div>
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
          <p className="login-subtitle">{t("auth.subtitle")}</p>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); setError("") }}
          >
            {t("auth.register")}
          </button>
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); setError("") }}
          >
            {t("auth.login")}
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
                placeholder={t("auth.firstNamePlaceholder")}
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
                placeholder={t("auth.lastNamePlaceholder")}
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
                placeholder={t("auth.usernamePlaceholder")}
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
                placeholder={t("auth.passwordPlaceholder")}
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
                placeholder={t("auth.passwordConfirmPlaceholder")}
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
                  placeholder={t("auth.captchaAnswer")}
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
        ) : awaiting2fa ? (
          <div className="login-fields">
            <div className="field-wrapper">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                className="login-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder={t("auth.code2faPlaceholder")}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerify2fa() }}
              />
            </div>
            <button
              className="link-btn"
              type="button"
              style={{ fontSize: 13 }}
              onClick={() => { setAwaiting2fa(false); setTwoFactorCode(""); setError("") }}
            >
              {t("auth.backToLogin")}
            </button>
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
                placeholder={t("auth.loginPasswordPlaceholder")}
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
            onClick={tab === "register" ? handleRegister : (awaiting2fa ? handleVerify2fa : handleLogin)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tab === "login") {
                if (awaiting2fa) handleVerify2fa()
                else handleLogin()
              }
            }}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                {tab === "register" ? t("auth.registering") : t("auth.loggingIn")}
              </span>
            ) : (
              <span className="btn-content">
                {tab === "register" ? t("auth.registerBtn") : (awaiting2fa ? t("auth.confirm2faBtn") : t("auth.loginBtn"))}
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
