import { useState, useEffect, useCallback } from "react"
import { verifyPin, isPinEnabled, resetAttempts, recordFailedAttempt, getLockoutTimeRemaining, isLockedOut } from "../services/pinLock"

interface Props {
  onUnlock: () => void
}

export default function PinLock({ onUnlock }: Props) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [locked, setLocked] = useState(isLockedOut())
  const [lockoutRemaining, setLockoutRemaining] = useState(getLockoutTimeRemaining())

  useEffect(() => {
    if (!isPinEnabled()) {
      onUnlock()
    }
  }, [onUnlock])

  useEffect(() => {
    if (!locked) return
    const interval = setInterval(() => {
      const rem = getLockoutTimeRemaining()
      if (rem <= 0) {
        setLocked(false)
        resetAttempts()
        clearInterval(interval)
      } else {
        setLockoutRemaining(rem)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [locked])

  const handleDigit = useCallback((d: string) => {
    if (locked) return
    setError("")
    setPin((prev) => {
      const next = prev + d
      if (next.length >= 4) {
        verifyPin(next).then((ok) => {
          if (ok) {
            resetAttempts()
            onUnlock()
          } else {
            const rem = recordFailedAttempt()
            setPin("")
            if (rem <= 0) {
              setLocked(true)
              setLockoutRemaining(getLockoutTimeRemaining())
              setError("Слишком много попыток. Подождите.")
            } else {
              setError(`Неверный PIN. Осталось попыток: ${rem}`)
            }
          }
        })
      }
      return next
    })
  }, [locked, onUnlock])

  const handleDelete = useCallback(() => {
    if (locked) return
    setPin((prev) => prev.slice(0, -1))
    setError("")
  }, [locked])

  const formatLockout = (ms: number) => {
    const sec = Math.ceil(ms / 1000)
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, "0")}`
  }

  return (
    <div className="pinlock-overlay">
      <div className="pinlock-card">
        <div className="pinlock-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2AABEE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="pinlock-title">NurChat</h2>
        <p className="pinlock-subtitle">Введите PIN-код</p>

        <div className="pinlock-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pinlock-dot ${pin.length > i ? "filled" : ""}`} />
          ))}
        </div>

        {error && <p className="pinlock-error">{error}</p>}

        {locked && (
          <p className="pinlock-locked">
            Блокировка {formatLockout(lockoutRemaining)}
          </p>
        )}

        <div className="pinlock-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => {
            if (d === "") return <div key={i} className="pinlock-key empty" />
            if (d === "⌫") {
              return (
                <button key={i} className="pinlock-key" onClick={handleDelete} disabled={locked}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" /><line x1="18" y1="9" x2="12" y2="15" /><line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              )
            }
            return (
              <button key={i} className="pinlock-key" onClick={() => handleDigit(d)} disabled={locked}>
                {d}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
