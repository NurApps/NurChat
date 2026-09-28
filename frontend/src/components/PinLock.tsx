import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { verifyPin, isPinEnabled, resetAttempts, recordFailedAttempt, getLockoutTimeRemaining, isLockedOut } from "../services/pinLock"
import { Delete, LockKeyhole } from "lucide-react"

interface Props {
  onUnlock: () => void
}

export default function PinLock({ onUnlock }: Props) {
  const { t } = useTranslation()
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
              setError(t("chat.tooManyAttempts"))
            } else {
              setError(t("pinLock.wrongPin", { count: rem }))
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
          <LockKeyhole size={48} color="#2AABEE" strokeWidth={2} aria-hidden="true" />
        </div>
        <h2 className="pinlock-title">NurChat</h2>
        <p className="pinlock-subtitle">{t("pinLock.enterPin")}</p>

        <div className="pinlock-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pinlock-dot ${pin.length > i ? "filled" : ""}`} />
          ))}
        </div>

        {error && <p className="pinlock-error">{error}</p>}

        {locked && (
          <p className="pinlock-locked">
            {t("pinLock.locked", { time: formatLockout(lockoutRemaining) })}
          </p>
        )}

        <div className="pinlock-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => {
            if (d === "") return <div key={i} className="pinlock-key empty" />
            if (d === "⌫") {
              return (
                <button key={i} className="pinlock-key" onClick={handleDelete} disabled={locked}>
                  <Delete size={24} strokeWidth={2} aria-hidden="true" />
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
