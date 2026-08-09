import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { BASE_URL } from "../config"

export default function LegalPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [privacy, setPrivacy] = useState("")
  const [agreement, setAgreement] = useState("")
  const [tab, setTab] = useState<"privacy" | "agreement">("privacy")

  useEffect(() => {
    fetch(`${BASE_URL}/api/legal/privacy/text`)
      .then((r) => r.json())
      .then((d) => setPrivacy(d.content || ""))
      .catch(() => setPrivacy(t("errors.general")))

    fetch(`${BASE_URL}/api/legal/agreement/text`)
      .then((r) => r.json())
      .then((d) => setAgreement(d.content || ""))
      .catch(() => setAgreement(t("errors.general")))
  }, [])

  const content = tab === "privacy" ? privacy : agreement

  return (
    <div className="legal-page">
      <div className="legal-header">
        <button className="legal-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2>{t("common.legal")}</h2>
      </div>
      <div className="legal-tabs">
        <button className={`legal-tab ${tab === "privacy" ? "active" : ""}`} onClick={() => setTab("privacy")}>
          {t("settings.privacy")}
        </button>
        <button className={`legal-tab ${tab === "agreement" ? "active" : ""}`} onClick={() => setTab("agreement")}>
          {t("auth.register")}
        </button>
      </div>
      <div className="legal-content">
        {content ? (
          content.split("\n").map((line, i) => {
            if (line.startsWith("# ")) return <h1 key={i}>{line.slice(2)}</h1>
            if (line.startsWith("## ")) return <h2 key={i}>{line.slice(3)}</h2>
            if (line.trim()) return <p key={i}>{line}</p>
            return <br key={i} />
          })
        ) : (
          <div className="legal-loading">{t("common.loading")}</div>
        )}
      </div>
    </div>
  )
}
