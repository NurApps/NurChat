import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"

export default function P2POnboarding() {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem("p2p_onboarding_seen")
    if (!seen) setShow(true)
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem("p2p_onboarding_seen", "1")
    setShow(false)
  }, [])

  if (!show) return null

  const steps = [
    {
      icon: "🔗",
      title: t("p2p.onboarding.step1Title"),
      desc: t("p2p.onboarding.step1Desc"),
    },
    {
      icon: "📱",
      title: t("p2p.onboarding.step2Title"),
      desc: t("p2p.onboarding.step2Desc"),
    },
    {
      icon: "🔒",
      title: t("p2p.onboarding.step3Title"),
      desc: t("p2p.onboarding.step3Desc"),
    },
    {
      icon: "🌐",
      title: t("p2p.onboarding.step4Title"),
      desc: t("p2p.onboarding.step4Desc"),
    },
  ]

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{
        background: "var(--surface, #161b22)", borderRadius: 16, padding: 32, maxWidth: 440,
        width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        border: "1px solid var(--border-color, #30363d)",
      }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--text-primary, #e6edf3)" }}>
          🌐 {t("p2p.onboarding.title")}
        </h3>
        <p style={{ color: "var(--text-secondary, #8b949e)", fontSize: 14, margin: "0 0 24px" }}>
          {t("p2p.onboarding.subtitle")}
        </p>

        <div style={{
          display: "flex", gap: 16, alignItems: "flex-start",
          background: "var(--input-bg, var(--surface-variant, #0d1117))", borderRadius: 12, padding: 20, minHeight: 110,
          border: "1px solid var(--border-color, #21262d)",
        }}>
          <div style={{ fontSize: 36, lineHeight: 1 }}>{steps[step].icon}</div>
          <div>
            <h4 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text-primary, #e6edf3)" }}>
              {steps[step].title}
            </h4>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary, #8b949e)", lineHeight: 1.5 }}>
              {steps[step].desc}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "20px 0" }}>
          {steps.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 24 : 8, height: 8, borderRadius: i === step ? 4 : "50%",
              background: i === step ? "var(--accent, #2563eb)" : "var(--border-color, #30363d)", transition: "all 0.2s",
            }} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={dismiss} style={{
            background: "none", border: "none", color: "var(--text-secondary, #8b949e)", cursor: "pointer",
            padding: "8px 16px", fontSize: 14,
          }}>{t("onboarding.skip")}</button>
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} style={{
              background: "var(--accent, #2563eb)", color: "white", border: "none", borderRadius: 8,
              padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
            }}>{t("chat.next")} →</button>
          ) : (
            <button onClick={dismiss} style={{
              background: "var(--accent, #2563eb)", color: "white", border: "none", borderRadius: 8,
              padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
            }}>{t("onboarding.start")}</button>
          )}
        </div>
      </div>
    </div>
  )
}
