import { useState, useEffect } from "react"
import { api } from "../services/api"

interface Props {
  messageId: string
  onClose: () => void
}

interface ReadInfo {
  read_count: number
  total_participants: number
}

export default function MessageInfoModal({ messageId, onClose }: Props) {
  const [readInfo, setReadInfo] = useState<ReadInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(false)
  }, [messageId])

  useEffect(() => {
    api.getReadCount(messageId).then(setReadInfo).catch(() => {})
  }, [messageId])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, padding: 24 }}>
        <h3 style={{ marginTop: 0 }}>Информация о сообщении</h3>

        {loading ? (
          <p style={{ textAlign: "center", color: "#888" }}>Загрузка...</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{
              background: "var(--input-bg)",
              borderRadius: 8,
              padding: 12,
            }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                ID сообщения
              </div>
              <div style={{ fontSize: 13, fontFamily: "monospace", wordBreak: "break-all" }}>
                {messageId}
              </div>
            </div>

            {readInfo && (
              <div style={{
                background: "var(--input-bg)",
                borderRadius: 8,
                padding: 12,
              }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Прочитали
                </div>
                <div style={{ fontSize: 13 }}>
                  {readInfo.read_count} из {readInfo.total_participants} участников
                </div>
                <div style={{
                  height: 4,
                  background: "var(--border)",
                  borderRadius: 2,
                  marginTop: 8,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${readInfo.total_participants > 0 ? (readInfo.read_count / readInfo.total_participants) * 100 : 0}%`,
                    background: "var(--tg-blue)",
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            )}

            <div style={{
              background: "var(--input-bg)",
              borderRadius: 8,
              padding: 12,
            }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                Зашифровано
              </div>
              <div style={{ fontSize: 13, color: "#4CAF50" }}>
                ✓ End-to-End шифрование
              </div>
            </div>
          </div>
        )}

        <button className="avatar-btn" onClick={onClose} style={{ marginTop: 16, width: "100%" }}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
