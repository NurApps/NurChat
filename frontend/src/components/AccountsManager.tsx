import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import QRCode from "qrcode"
import { getRelayConfig } from "../config"
import { ensureActiveProfile, type AccountProfile } from "../services/profiles"
import { readStoredUserRaw } from "../services/tokenVault"
import { storedAccount } from "../services/localSession"
import AccountList from "./AccountList"
import {
  QR_MAX_CHARS,
  decryptTransferBundle,
  exportCompactTransferBundle,
  exportTransferBundle,
  importTransferBundle,
  wipeProfileData,
} from "../services/transferBundle"
import QrScanner from "./QrScanner"

function storedUserId(): string | null {
  try {
    const raw = readStoredUserRaw()
    if (!raw) return null
    const parsed = JSON.parse(raw) as { id?: unknown }
    return typeof parsed.id === "string" ? parsed.id : null
  } catch {
    return null
  }
}

/**
 * Мультиаккаунт (активен один) + переезд на другое устройство.
 * Один фронт на десктоп и мобайл — отдельная вёрстка не нужна.
 */
export default function AccountsManager({ showList = true, activeAvatarSrc }: { showList?: boolean; activeAvatarSrc?: string | null }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")
  const [exportPw, setExportPw] = useState("")
  const [wipeAfterExport, setWipeAfterExport] = useState(true)
  const [importPw, setImportPw] = useState("")
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [scanning, setScanning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fail = (e: unknown, fallback: string) => {
    const code = e instanceof Error ? e.message : ""
    if (code === "bad-password") setErr(t("settings.transferBadPassword"))
    else if (code === "bad-format") setErr(t("settings.transferBadFile"))
    else if (code === "no-identity") setErr(t("settings.transferNoKeys"))
    else setErr(fallback)
  }

  const handleRemove = async (p: AccountProfile) => {
    setBusy(true)
    try {
      await wipeProfileData(p.id)
      setMsg(t("settings.accountRemoved"))
    } catch (e) {
      fail(e, t("settings.accountRemoveFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    setErr("")
    setMsg("")
    if (exportPw.length < 8) {
      setErr(t("settings.transferPwTooShort"))
      return
    }
    const account = storedAccount()
    const userId = storedUserId()
    if (!account || !userId) {
      setErr(t("settings.transferNoSession"))
      return
    }
    setBusy(true)
    try {
      const relay = getRelayConfig()
      const profile = ensureActiveProfile(relay.protocol, relay.host, userId, account.username)
      const envelope = await exportTransferBundle(
        profile.relayHost,
        profile.relayProtocol,
        profile.username,
        profile.userId,
        exportPw,
      )
      const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `nurchat-transfer-${profile.username}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setExportPw("")
      if (wipeAfterExport) {
        // Переезд, а не клон: ключи на старом устройстве затираются,
        // иначе форк Double Ratchet сломает расшифровку.
        await wipeProfileData(profile.id)
        return // wipe сам перезагружает, если профиль был активен
      }
      setMsg(t("settings.transferExported"))
    } catch (e) {
      fail(e, t("settings.transferExportFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setErr("")
    setMsg("")
    if (importPw.length < 8) {
      setErr(t("settings.transferPwTooShort"))
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      await importFromText(text)
    } catch (e) {
      fail(e, t("settings.transferImportFailed"))
    } finally {
      setBusy(false)
    }
  }

  /** Общий финал импорта: расшифровка текстом (файл или QR) → confirm → ввоз. */
  const importFromText = async (text: string) => {
    const payload = await decryptTransferBundle(JSON.parse(text), importPw)
    if (
      !window.confirm(
        t("settings.transferImportConfirm", {
          name: `${payload.username}@${payload.relayHost}`,
        }),
      )
    ) {
      return
    }
    await importTransferBundle(payload)
    // import перезагружает приложение
  }

  const handleScanDecode = async (text: string) => {
    setScanning(false)
    setErr("")
    setMsg("")
    if (importPw.length < 8) {
      setErr(t("settings.transferPwTooShort"))
      return
    }
    setBusy(true)
    try {
      await importFromText(text)
    } catch (e) {
      fail(e, t("settings.transferImportFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleShowQr = async () => {
    setErr("")
    setMsg("")
    setQrDataUrl("")
    if (exportPw.length < 8) {
      setErr(t("settings.transferPwTooShort"))
      return
    }
    const account = storedAccount()
    const userId = storedUserId()
    if (!account || !userId) {
      setErr(t("settings.transferNoSession"))
      return
    }
    setBusy(true)
    try {
      const relay = getRelayConfig()
      const profile = ensureActiveProfile(relay.protocol, relay.host, userId, account.username)
      // QR — компактный бандл: без OPK (сервер догрузит) и outbox
      // (остаётся на старом устройстве).
      const envelope = await exportCompactTransferBundle(
        profile.relayHost,
        profile.relayProtocol,
        profile.username,
        profile.userId,
        exportPw,
      )
      const text = JSON.stringify(envelope)
      if (text.length > QR_MAX_CHARS) {
        setErr(t("settings.transferQrTooBig"))
        return
      }
      setQrDataUrl(await QRCode.toDataURL(text, { errorCorrectionLevel: "M", width: 320, margin: 2 }))
      setMsg(t("settings.transferQrReady"))
    } catch (e) {
      fail(e, t("settings.transferExportFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-sections">
      {showList && (
        <div className="settings-group">
          <h3 className="settings-group-title">{t("settings.accountsTitle")}</h3>
          <AccountList variant="settings" activeAvatarSrc={activeAvatarSrc} onRemove={handleRemove} />
        </div>
      )}

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.transferTitle")}</h3>
        <p className="settings-info-text">{t("settings.transferDesc")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="settings-action-btn" onClick={() => { setShowExport((v) => !v); setShowImport(false) }}>
            {t("settings.transferExport")}
          </button>
          <button type="button" className="settings-action-btn" onClick={() => { setShowImport((v) => !v); setShowExport(false) }}>
            {t("settings.transferImport")}
          </button>
        </div>

        {showExport && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="settings-label">{t("settings.transferPassword")}</label>
            <input
              type="password"
              className="settings-input"
              autoComplete="new-password"
              value={exportPw}
              onChange={(e) => setExportPw(e.target.value)}
              placeholder="••••••••"
            />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={wipeAfterExport} onChange={(e) => setWipeAfterExport(e.target.checked)} />
              {t("settings.transferWipeAfterExport")}
            </label>
            <button type="button" className="settings-save-btn" disabled={busy} onClick={handleExport} style={{ width: "auto", padding: "0 16px", height: 40 }}>
              {t("settings.transferExportGo")}
            </button>
            <button type="button" className="settings-action-btn" disabled={busy} onClick={handleShowQr} style={{ width: "auto", padding: "0 16px", height: 40 }}>
              {t("settings.transferShowQr")}
            </button>
            {qrDataUrl && (
              <>
                <img src={qrDataUrl} alt="transfer QR" style={{ width: 240, height: 240, borderRadius: 8, background: "#fff" }} />
                <p className="settings-info-text">{t("settings.transferQrCompactNote")}</p>
              </>
            )}
          </div>
        )}

        {showImport && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="settings-label">{t("settings.transferPassword")}</label>
            <input
              type="password"
              className="settings-input"
              autoComplete="current-password"
              value={importPw}
              onChange={(e) => setImportPw(e.target.value)}
              placeholder="••••••••"
            />
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (f) void handleImportFile(f)
              }}
            />
            <button type="button" className="settings-save-btn" disabled={busy} onClick={() => fileRef.current?.click()} style={{ width: "auto", padding: "0 16px", height: 40 }}>
              {t("settings.transferImportGo")}
            </button>
            <button type="button" className="settings-action-btn" disabled={busy} onClick={() => setScanning((v) => !v)} style={{ width: "auto", padding: "0 16px", height: 40 }}>
              {t("settings.transferScanQr")}
            </button>
            {scanning && <QrScanner onDecode={(text) => void handleScanDecode(text)} onClose={() => setScanning(false)} />}
          </div>
        )}

        {(msg || err) && (
          <p className="settings-info-text" style={{ color: err ? "var(--error)" : "var(--success)" }}>
            {err || msg}
          </p>
        )}
      </div>
    </div>
  )
}
