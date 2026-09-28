import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, LockKeyhole, MessageCircle, Server, ShieldCheck } from "lucide-react"

const ICONS = [
  <KeyRound size={28} strokeWidth={1.8} aria-hidden="true" />,
  <ShieldCheck size={28} strokeWidth={1.8} aria-hidden="true" />,
  <LockKeyhole size={28} strokeWidth={1.8} aria-hidden="true" />,
  <Server size={28} strokeWidth={1.8} aria-hidden="true" />,
  <MessageCircle size={28} strokeWidth={1.8} aria-hidden="true" />,
]

export default function Onboarding() {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const seen = localStorage.getItem("onboarding_seen")
    if (!seen) setShow(true)
  }, [])

  const dismiss = useCallback(() => {
    localStorage.setItem("onboarding_seen", "1")
    setShow(false)
  }, [])

  if (!show) return null

  const steps = [
    { title: t("onboarding.step1Title"), desc: t("onboarding.step1Desc") },
    { title: t("onboarding.step2Title"), desc: t("onboarding.step2Desc") },
    { title: t("onboarding.step3Title"), desc: t("onboarding.step3Desc") },
    { title: t("onboarding.step4Title"), desc: t("onboarding.step4Desc") },
    { title: t("onboarding.step5Title"), desc: t("onboarding.step5Desc") },
  ]

  return (
    <div className="modal-overlay ob-overlay">
      <div className="modal-content ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <h3 id="ob-title" className="ob-title">{t("onboarding.welcome")}</h3>
        <p className="ob-subtitle">{t("onboarding.subtitle")}</p>

        <div key={step} className="ob-step animate-fade-in-scale">
          <div className="ob-icon">{ICONS[step]}</div>
          <div>
            <h4 className="ob-step-title">{steps[step].title}</h4>
            <p className="ob-step-desc">{steps[step].desc}</p>
          </div>
        </div>

        <div className="ob-dots">
          {steps.map((s, i) => (
            <button key={s.title} type="button" onClick={() => setStep(i)}
              aria-label={`${i + 1} / ${steps.length}`}
              aria-current={i === step ? "step" : undefined}
              className={`ob-dot${i === step ? " active" : ""}`} />
          ))}
        </div>

        <div className="ob-actions">
          <button type="button" className="link-btn" onClick={dismiss}>{t("onboarding.skip")}</button>
          {step < steps.length - 1 ? (
            <button type="button" className="ob-next" onClick={() => setStep((s) => s + 1)}>{t("chat.next")}</button>
          ) : (
            <button type="button" className="ob-next" onClick={dismiss}>{t("onboarding.start")}</button>
          )}
        </div>
      </div>
    </div>
  )
}
