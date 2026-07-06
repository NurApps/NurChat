import { useState, useEffect } from "react"
import { generateSafetyNumber, verifySafetyNumber } from "../services/safetyNumber"
import { loadKeys } from "../services/e2e"
import { markKeyVerified } from "../services/keyVerification"

interface Props {
  theirPublicKey: string
  theirUsername: string
  onClose: () => void
}

export default function SafetyNumberModal({ theirPublicKey, theirUsername, onClose }: Props) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null)
  const [verifyInput, setVerifyInput] = useState("")
  const [verified, setVerified] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)
  const [showQR, setShowQR] = useState(false)

  useEffect(() => {
    const keys = loadKeys()
    if (keys) {
      generateSafetyNumber(keys.publicKeyHex, theirPublicKey).then(setSafetyNumber)
    }
  }, [theirPublicKey])

  const handleCopy = () => {
    if (safetyNumber) {
      navigator.clipboard.writeText(safetyNumber.replace(/\s/g, ""))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleVerify = async () => {
    const keys = loadKeys()
    if (!keys || !safetyNumber) return
    const result = await verifySafetyNumber(keys.publicKeyHex, theirPublicKey, verifyInput)
    setVerified(result)
    if (result) {
      // Mark key as verified
      markKeyVerified(theirPublicKey)
    }
  }

  const qrUrl = safetyNumber
    ? `https://api.qrserver.com/v1/create-qr-code/?data=nurchat-verify:${safetyNumber.replace(/\s/g, "")}&size=200x200&bgcolor=1a1a2e&color=ffffff`
    : ""

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, padding: 24 }}>
        <h3 style={{ marginTop: 0 }}>Проверка ключей</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Сравните этот код с {theirUsername}. Если коды совпадают — E2E шифрование подтверждено.
        </p>

        {safetyNumber ? (
          <div style={{
            background: "var(--input-bg)",
            borderRadius: 8,
            padding: 16,
            fontFamily: "monospace",
            fontSize: 18,
            letterSpacing: 2,
            textAlign: "center",
            margin: "16px 0",
            lineHeight: 1.6,
            userSelect: "all",
            cursor: "pointer",
          }} onClick={handleCopy}>
            {safetyNumber}
          </div>
        ) : (
          <p style={{ textAlign: "center", color: "#888" }}>Загрузка...</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="settings-save-btn"
            onClick={handleCopy}
            style={{ flex: 1 }}
          >
            {copied ? "Скопировано!" : "Копировать"}
          </button>
          <button
            className="settings-save-btn"
            onClick={() => setShowQR(!showQR)}
            style={{ flex: 1, background: showQR ? "var(--tg-blue)" : undefined }}
          >
            {showQR ? "Скрыть QR" : "Показать QR"}
          </button>
        </div>

        {showQR && qrUrl && (
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <img
              src={qrUrl}
              alt="Safety Number QR"
              style={{
                width: 200,
                height: 200,
                borderRadius: 8,
                border: "2px solid var(--border)",
              }}
            />
            <p style={{ fontSize: 11, color: "#888", marginTop: 8 }}>
              Отсканируйте QR-код друг у друга
            </p>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px" }}>
            Введите код от {theirUsername} для проверки:
          </p>
          <input
            className="settings-input"
            placeholder="Вставьте код собеседника..."
            value={verifyInput}
            onChange={(e) => { setVerifyInput(e.target.value); setVerified(null) }}
          />
          <button
            className="settings-save-btn"
            onClick={handleVerify}
            disabled={!verifyInput}
            style={{ marginTop: 8, width: "100%" }}
          >
            Проверить
          </button>
          {verified === true && (
            <p style={{ color: "#4CAF50", fontSize: 13, marginTop: 8, textAlign: "center" }}>
              ✓ Коды совпадают — ключи подтверждены
            </p>
          )}
          {verified === false && (
            <p style={{ color: "#f44336", fontSize: 13, marginTop: 8, textAlign: "center" }}>
              ✗ Коды не совпадают — возможно, ключи были изменены
            </p>
          )}
        </div>

        <button className="avatar-btn" onClick={onClose} style={{ marginTop: 16, width: "100%" }}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
