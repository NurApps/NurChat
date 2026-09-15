import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"

function StepIcon({ d }: { d: string[] }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((path, i) => <path key={i} d={path} />)}
    </svg>
  )
}

const ICONS: string[][] = [
  // identity — key stays on the device
  ["M14 10a4 4 0 1 0-3.4 3.9", "M10.6 13.9 20 3.5", "M16.5 7l2.5 2.5", "M13.5 10l2 2"],
  // keys are yours — shield
  ["M12 3l7 2.8v5.1c0 4.9-3.4 7.9-7 9.1-3.6-1.2-7-4.2-7-9.1V5.8z", "M9.3 11.8l2 2 3.4-3.9"],
  // e2e — lock
  ["M5 11h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 8 0v3"],
  // shared relay — server
  ["M4 4.5h16a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z", "M4 14.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3.5a1 1 0 0 1 1-1z", "M7 7.2h.01", "M7 17.2h.01"],
  // chat
  ["M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z"],
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

        <div className="ob-step">
          <div className="ob-icon"><StepIcon d={ICONS[step]} /></div>
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
