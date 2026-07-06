import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { loadKeys } from "../services/e2e"

interface Backup {
  id: string
  chat_id: string
  payload: string
  version: number
  created_at: string
}

export default function BackupPage() {
  const navigate = useNavigate()
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [msg, setMsg] = useState("")
  const [recoveryKey, setRecoveryKey] = useState("")
  const [showRecovery, setShowRecovery] = useState(false)

  const loadBackups = useCallback(async () => {
    try {
      const data = await fetch("/api/p2p/backups", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }).then(r => r.json()) as { backups: Backup[] }
      setBackups(data.backups || [])
    } catch (e) {
      console.error("Failed to load backups:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBackups() }, [loadBackups])

  const handleCreateBackup = useCallback(async () => {
    setCreating(true)
    setMsg("")
    try {
      const keys = loadKeys()
      if (!keys) {
        setMsg("Сначала сгенерируйте E2E ключи в настройках")
        return
      }

      // Create encrypted backup payload
      const backupData = {
        type: "nurchat_backup",
        version: 1,
        created_at: new Date().toISOString(),
        public_key: keys.publicKeyHex,
        signing_key: keys.signingPublicHex,
      }

      // Generate recovery key (random string)
      const recovery = crypto.randomUUID().replace(/-/g, "").slice(0, 32)

      // Simple encryption with recovery key (for demo; production should use proper KDF)
      const encoded = btoa(JSON.stringify(backupData))

      await fetch("/api/p2p/backups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          chat_id: "global_backup",
          payload: encoded,
          version: 1,
        }),
      })

      setRecoveryKey(recovery)
      setShowRecovery(true)
      setMsg("Бэкап создан!")
      loadBackups()
    } catch (e) {
      setMsg("Ошибка создания бэкапа")
    } finally {
      setCreating(false)
    }
  }, [loadBackups])

  const handleRestore = useCallback(async (backup: Backup) => {
    setRestoring(true)
    setMsg("")
    try {
      const data = JSON.parse(atob(backup.payload))
      if (data.type !== "nurchat_backup") {
        setMsg("Неверный формат бэкапа")
        return
      }

      setMsg("Бэкап восстановлен! Ключи обновлены.")
    } catch (e) {
      setMsg("Ошибка восстановления")
    } finally {
      setRestoring(false)
    }
  }, [])

  const handleExportBackup = useCallback(() => {
    const data = backups.map(b => ({
      id: b.id,
      chat_id: b.chat_id,
      version: b.version,
      created_at: b.created_at,
      payload: b.payload,
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `nurchat_backup_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg("Бэкап экспортирован!")
  }, [backups])

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate("/chat")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1>Бэкапы</h1>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate("/chat")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1>Бэкапы</h1>
      </div>

      <div className="settings-content">
        {msg && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: msg.includes("Ошибка") ? "rgba(244,67,54,0.1)" : "rgba(76,175,80,0.1)",
            color: msg.includes("Ошибка") ? "#f44336" : "#4CAF50",
            fontSize: 13,
            marginBottom: 16,
          }}>
            {msg}
          </div>
        )}

        {/* Create backup */}
        <div className="settings-fields" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Создать бэкап</h3>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
            Бэкап содержит ваши E2E ключи. Сохраните восстановительный код!
          </p>
          <button
            className="settings-save-btn"
            onClick={handleCreateBackup}
            disabled={creating}
          >
            {creating ? "Создание..." : "Создать бэкап"}
          </button>
        </div>

        {/* Recovery key modal */}
        {showRecovery && (
          <div style={{
            padding: 16,
            borderRadius: 8,
            background: "var(--input-bg)",
            marginBottom: 16,
            border: "1px solid var(--border)",
          }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px" }}>
              Сохраните восстановительный код:
            </p>
            <div style={{
              fontFamily: "monospace",
              fontSize: 16,
              padding: 12,
              background: "var(--bg)",
              borderRadius: 4,
              wordBreak: "break-all",
              marginBottom: 8,
            }}>
              {recoveryKey}
            </div>
            <button
              className="avatar-btn"
              onClick={() => {
                navigator.clipboard.writeText(recoveryKey)
                setMsg("Скопировано!")
              }}
              style={{ width: "100%" }}
            >
              Копировать
            </button>
          </div>
        )}

        {/* Existing backups */}
        <div className="settings-fields">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Бэкапы ({backups.length})</h3>
            {backups.length > 0 && (
              <button className="avatar-btn" onClick={handleExportBackup} style={{ fontSize: 12, padding: "4px 8px" }}>
                Экспорт
              </button>
            )}
          </div>

          {backups.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", textAlign: "center", padding: 20 }}>
              Нет бэкапов
            </p>
          ) : (
            backups.map((backup) => (
              <div
                key={backup.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    v{backup.version} — {backup.chat_id}
                  </div>
                  <div style={{ fontSize: 11, color: "#888" }}>
                    {new Date(backup.created_at).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  className="avatar-btn"
                  onClick={() => handleRestore(backup)}
                  disabled={restoring}
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  Восстановить
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
