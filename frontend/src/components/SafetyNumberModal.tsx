import { useState, useEffect } from "react"
import { generateSafetyNumber } from "../services/e2e"
import { loadKeys } from "../services/e2e"
import { api } from "../services/api"

interface Props {
  theirUserId: string
  theirPublicKey?: string | null
  theirUsername: string
  onClose: () => void
}

export default function SafetyNumberModal({ theirUserId, theirPublicKey, theirUsername, onClose }: Props) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const myKeys = await loadKeys()
        if (!myKeys) {
          setError("Ключи не найдены")
          return
        }

        // Prefer the key the caller already has (no round trip, works offline);
        // fall back to fetching the current identity key from the relay.
        let theirIdentityKey = theirPublicKey || null
        if (!theirIdentityKey) {
          const remoteKeys = await api.getIdentityKeys(theirUserId)
          theirIdentityKey = remoteKeys.identity_key
        }
        const myIdentityKey = myKeys.signingPublicHex

        if (!myIdentityKey || !theirIdentityKey) {
          setError("Identity ключ не найден")
          return
        }

        const { digits } = generateSafetyNumber(myIdentityKey, theirIdentityKey)
        setSafetyNumber(digits)
      } catch (err) {
        setError("Ошибка генерации Safety Number")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [theirUserId, theirPublicKey])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 24 }}>
        <h3 style={{ margin: "0 0 8px" }}>Safety Number</h3>
        <p style={{ margin: "0 0 16px", opacity: 0.7, fontSize: 14 }}>
          Сравните этот код с {theirUsername} для проверки личности.
          Если коды совпадают — шифрование работает правильно.
        </p>

        {loading && <div className="spinner" />}
        {error && <p style={{ color: "#ef4444" }}>{error}</p>}
        {safetyNumber && (
          <div style={{
            fontFamily: "monospace",
            fontSize: 18,
            letterSpacing: 2,
            textAlign: "center",
            padding: 16,
            background: "var(--bg-secondary)",
            borderRadius: 8,
            marginBottom: 16,
            lineHeight: 1.8,
          }}>
            {safetyNumber}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
