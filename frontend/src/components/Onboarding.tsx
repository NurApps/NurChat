import { useState, useEffect, useCallback } from "react"

export default function Onboarding() {
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
    { icon: "🔓", title: "1. Откройте порт", desc: "Нажмите «Открыть порт» — ваш сервер станет доступен другим пользователям." },
    { icon: "📋", title: "2. Скопируйте ссылку", desc: "Нажмите «Копировать» — получите уникальную ссылку-приглашение." },
    { icon: "📤", title: "3. Отправьте другу", desc: "Киньте ссылку в Telegram, WhatsApp, email — друг вставит её и подключится напрямую." },
    { icon: "💬", title: "4. Общайтесь!", desc: "Все сообщения идут напрямую между вашими серверами. Без VPS, без посредников." },
  ]

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{
        background: "white", borderRadius: 16, padding: 32, maxWidth: 420,
        width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 22 }}>🚀 Добро пожаловать в NurChat!</h3>
        <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px" }}>
          Децентрализованный мессенджер. Ваши данные — только у вас.
        </p>

        <div style={{
          display: "flex", gap: 16, alignItems: "flex-start",
          background: "#f3f4f6", borderRadius: 12, padding: 20, minHeight: 100,
        }}>
          <div style={{ fontSize: 36, lineHeight: 1 }}>{steps[step].icon}</div>
          <div>
            <h4 style={{ margin: "0 0 6px", fontSize: 16 }}>{steps[step].title}</h4>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{steps[step].desc}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "20px 0" }}>
          {steps.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 24 : 8, height: 8, borderRadius: i === step ? 4 : "50%",
              background: i === step ? "#2563eb" : "#d1d5db", transition: "all 0.2s",
            }} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={dismiss} style={{
            background: "none", border: "none", color: "#9ca3af", cursor: "pointer", padding: "8px 16px", fontSize: 14,
          }}>Пропустить</button>
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} style={{
              background: "#2563eb", color: "white", border: "none", borderRadius: 8,
              padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
            }}>Далее →</button>
          ) : (
            <button onClick={dismiss} style={{
              background: "#2563eb", color: "white", border: "none", borderRadius: 8,
              padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
            }}>Начать! 🎉</button>
          )}
        </div>
      </div>
    </div>
  )
}
