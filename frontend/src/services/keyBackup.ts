/**
 * E2E Key Backup & Recovery Service
 * Позволяет экспортировать и импортировать ключи шифрования
 */
import { loadKeys, saveKeys, type E2EKeys } from "./e2e"

const BACKUP_KEY = "e2e_backup"
const BACKUP_META_KEY = "e2e_backup_meta"

interface BackupMeta {
  createdAt: string
  keyCount: number
}

export function exportKeys(password: string): { backup: string; meta: BackupMeta } | null {
  const keys = loadKeys()
  if (!keys) return null

  const data = JSON.stringify(keys)
  const encrypted = btoa(simpleXor(data, password))
  const backup = `NURCHAT_E2E_BACKUP_v1:${encrypted}`

  const meta: BackupMeta = {
    createdAt: new Date().toISOString(),
    keyCount: 1,
  }

  localStorage.setItem(BACKUP_KEY, backup)
  localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta))

  return { backup, meta }
}

export function importKeys(backupStr: string, password: string): boolean {
  try {
    if (!backupStr.startsWith("NURCHAT_E2E_BACKUP_v1:")) return false

    const encrypted = backupStr.slice("NURCHAT_E2E_BACKUP_v1:".length)
    const decrypted = simpleXor(atob(encrypted), password)
    const keys: E2EKeys = JSON.parse(decrypted)

    if (!keys.privateKeyHex || !keys.publicKeyHex || !keys.signingPrivateHex || !keys.signingPublicHex) {
      return false
    }

    saveKeys(keys)
    return true
  } catch {
    return false
  }
}

export function getBackupMeta(): BackupMeta | null {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function hasBackup(): boolean {
  return !!localStorage.getItem(BACKUP_KEY)
}

export function clearBackup() {
  localStorage.removeItem(BACKUP_KEY)
  localStorage.removeItem(BACKUP_META_KEY)
}

function simpleXor(data: string, key: string): string {
  let result = ""
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return result
}
