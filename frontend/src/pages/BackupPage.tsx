import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { loadKeys, saveKeys, type E2EKeys } from "../services/e2e"
import { encode as base64Encode, decode as base64Decode } from "base64-arraybuffer"
import { BASE_URL } from "../config"

interface Backup {
  id: string
  chat_id: string
  payload: string
  version: number
  created_at: string
}

interface EncryptedBackupData {
  type: "nurchat_backup"
  version: number
  created_at: string
  encryptedKeys: string // base64 encoded encrypted keys
  nonce: string // base64 encoded nonce
}

// Derive encryption key from password using PBKDF2
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

// Generate random salt
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

// Encrypt backup data with password
async function encryptBackupData(keys: E2EKeys, password: string): Promise<string> {
  const salt = generateSalt()
  const key = await deriveKeyFromPassword(password, salt)
  
  const dataToEncrypt = JSON.stringify({
    privateKeyHex: keys.privateKeyHex,
    publicKeyHex: keys.publicKeyHex,
    signingPrivateHex: keys.signingPrivateHex,
    signingPublicHex: keys.signingPublicHex,
  })
  
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(dataToEncrypt)
  )
  
  const backupData: EncryptedBackupData = {
    type: "nurchat_backup",
    version: 2,
    created_at: new Date().toISOString(),
    encryptedKeys: base64Encode((new Uint8Array(encrypted)).buffer as ArrayBuffer),
    nonce: base64Encode(iv.buffer as ArrayBuffer),
  }
  
  // Include salt in the final payload
  const fullPayload = {
    ...backupData,
    salt: base64Encode(salt.buffer as ArrayBuffer),
  }
  
  return btoa(JSON.stringify(fullPayload))
}

// Decrypt backup data with password
async function decryptBackupData(encryptedPayload: string, password: string): Promise<E2EKeys | null> {
  try {
    const parsed = JSON.parse(atob(encryptedPayload))
    
    if (parsed.type !== "nurchat_backup" || parsed.version < 2) {
      console.error("Invalid backup format")
      return null
    }
    
    const salt = new Uint8Array(base64Decode(parsed.salt))
    const key = await deriveKeyFromPassword(password, salt)
    
    const encryptedData = new Uint8Array(base64Decode(parsed.encryptedKeys))
    const iv = new Uint8Array(base64Decode(parsed.nonce))
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedData
    )
    
    const dec = new TextDecoder()
    const keysJson = dec.decode(decrypted)
    
    return JSON.parse(keysJson) as E2EKeys
  } catch (error) {
    console.error("Failed to decrypt backup:", error)
    return null
  }
}

export default function BackupPage() {
  const navigate = useNavigate()
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [msg, setMsg] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [backupPassword, setBackupPassword] = useState("")
  const [restorePassword, setRestorePassword] = useState("")
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null)
  const [fileError, setFileError] = useState("")

  const loadBackups = useCallback(async () => {
    try {
      const data = await fetch(`${BASE_URL}/api/p2p/backups`, {
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
    if (!backupPassword || backupPassword.length < 8) {
      setMsg("Пароль должен быть не менее 8 символов")
      return
    }

    setCreating(true)
    setMsg("")
    try {
      const keys = await loadKeys()
      if (!keys) {
        setMsg("Сначала сгенерируйте E2E ключи в настройках")
        return
      }

      // Create encrypted backup payload
      const encryptedPayload = await encryptBackupData(keys, backupPassword)

      const backupData = {
        type: "nurchat_backup",
        version: 2,
        created_at: new Date().toISOString(),
        encryptedPayload,
      }

      await fetch(`${BASE_URL}/api/p2p/backups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          chat_id: "global_backup",
          payload: btoa(JSON.stringify(backupData)),
          version: 2,
        }),
      })

      setMsg("Бэкап создан и зашифрован!")
      setShowCreateModal(false)
      setBackupPassword("")
      loadBackups()
    } catch (e) {
      setMsg("Ошибка создания бэкапа")
    } finally {
      setCreating(false)
    }
  }, [backupPassword, loadBackups])

  const handleRestore = useCallback(async (backup: Backup, password: string) => {
    setRestoring(true)
    setMsg("")
    try {
      const outerData = JSON.parse(atob(backup.payload))
      
      if (!outerData.encryptedPayload) {
        setMsg("Неверный формат бэкапа (требуется версия 2+)")
        return
      }

      const keys = await decryptBackupData(outerData.encryptedPayload, password)
      
      if (!keys) {
        setMsg("Неверный пароль или поврежденный бэкап")
        return
      }

      await saveKeys(keys)
      setMsg("Бэкап восстановлен! Ключи обновлены.")
      setShowRestoreModal(false)
      setRestorePassword("")
      setSelectedBackup(null)
    } catch (e) {
      setMsg("Ошибка восстановления: неверный пароль или поврежденный файл")
    } finally {
      setRestoring(false)
    }
  }, [])

  const handleImportBackup = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setFileError("")
    setMsg("")

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      
      if (!Array.isArray(data) || data.length === 0) {
        setFileError("Неверный формат файла импорта")
        return
      }

      // Import first backup from file
      const backupToImport = data[0]
      if (!backupToImport.payload) {
        setFileError("Неверный формат бэкапа в файле")
        return
      }

      // Show restore modal for imported backup
      setSelectedBackup({
        id: backupToImport.id || `imported_${Date.now()}`,
        chat_id: backupToImport.chat_id || "imported",
        payload: backupToImport.payload,
        version: backupToImport.version || 2,
        created_at: backupToImport.created_at || new Date().toISOString(),
      })
      setShowRestoreModal(true)
    } catch (e) {
      setFileError("Ошибка чтения файла: " + (e as Error).message)
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

        {fileError && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(244,67,54,0.1)",
            color: "#f44336",
            fontSize: 13,
            marginBottom: 16,
          }}>
            {fileError}
          </div>
        )}

        {/* Create backup with password modal */}
        <div className="settings-fields" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Создать бэкап</h3>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
            Бэкап содержит ваши E2E ключи, зашифрованные паролем (минимум 8 символов).
          </p>
          {!showCreateModal ? (
            <button
              className="settings-save-btn"
              onClick={() => setShowCreateModal(true)}
            >
              Создать бэкап
            </button>
          ) : (
            <div style={{
              padding: 16,
              borderRadius: 8,
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
            }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>
                Пароль для шифрования
              </label>
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Введите пароль (мин. 8 символов)"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  marginBottom: 12,
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="avatar-btn"
                  onClick={() => {
                    setShowCreateModal(false)
                    setBackupPassword("")
                  }}
                  disabled={creating}
                >
                  Отмена
                </button>
                <button
                  className="settings-save-btn"
                  onClick={handleCreateBackup}
                  disabled={creating || backupPassword.length < 8}
                  style={{ flex: 1 }}
                >
                  {creating ? "Шифрование..." : "Создать и сохранить"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Import backup from file */}
        <div className="settings-fields" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Импортировать бэкап</h3>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
            Загрузите файл .json с бэкапом и введите пароль для расшифровки.
          </p>
          <input
            type="file"
            accept=".json"
            onChange={handleImportBackup}
            style={{
              padding: "8px 0",
              fontSize: 13,
            }}
          />
        </div>

        {/* Restore modal for selected backup */}
        {showRestoreModal && selectedBackup && (
          <div style={{
            padding: 16,
            borderRadius: 8,
            background: "var(--input-bg)",
            marginBottom: 16,
            border: "1px solid var(--border)",
          }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px" }}>
              Восстановление из бэкапа: {selectedBackup.chat_id}
            </p>
            <p style={{ fontSize: 11, color: "#888", margin: "0 0 12px" }}>
              Введите пароль для расшифровки ключей
            </p>
            <input
              type="password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
              placeholder="Пароль от бэкапа"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="avatar-btn"
                onClick={() => {
                  setShowRestoreModal(false)
                  setRestorePassword("")
                  setSelectedBackup(null)
                }}
                disabled={restoring}
              >
                Отмена
              </button>
              <button
                className="settings-save-btn"
                onClick={() => handleRestore(selectedBackup!, restorePassword)}
                disabled={restoring || !restorePassword}
                style={{ flex: 1 }}
              >
                {restoring ? "Расшифровка..." : "Восстановить"}
              </button>
            </div>
          </div>
        )}

        {/* Existing backups */}
        <div className="settings-fields">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Бэкапы на сервере ({backups.length})</h3>
            {backups.length > 0 && (
              <button className="avatar-btn" onClick={handleExportBackup} style={{ fontSize: 12, padding: "4px 8px" }}>
                Экспорт
              </button>
            )}
          </div>

          {backups.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", textAlign: "center", padding: 20 }}>
              Нет бэкапов на сервере
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
                  onClick={() => {
                    setSelectedBackup(backup)
                    setShowRestoreModal(true)
                  }}
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
