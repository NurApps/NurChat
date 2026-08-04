import { useState, useEffect } from "react"
import { check } from "@tauri-apps/plugin-updater"
import { platform } from "../services/platform"

interface UpdateProgress {
  downloaded: number
  contentLength: number
}

export default function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!platform.isTauri) return
    const timer = setTimeout(async () => {
      try {
        const update = await check()
        if (update) setVersion(update.version)
      } catch {
        /* offline / updater unavailable */
      }
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  const handleInstall = async () => {
    if (!version) return
    setInstalling(true)
    setError(null)
    try {
      const update = await check()
      if (!update) {
        setInstalling(false)
        return
      }
      let downloaded = 0
      let contentLength = 0
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0
            break
          case "Progress":
            downloaded += event.data.chunkLength
            break
          case "Finished":
            break
        }
        setProgress({ downloaded, contentLength })
      })
      await platform.relaunchApp()
    } catch (e) {
      setError(String(e))
      setInstalling(false)
    }
  }

  if (!platform.isTauri || !version || dismissed) return null

  const pct = progress && progress.contentLength > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100))
    : 0

  return (
    <div className="update-banner">
      {installing ? (
        <div className="update-banner-installing">
          <span>Скачивание обновления {version}… {pct}%</span>
          {progress && progress.contentLength > 0 && (
            <div className="update-banner-progress">
              <div className="update-banner-progress-bar" style={{ width: `${pct}%` }} />
            </div>
          )}
          {error && <span className="update-banner-error">{error}</span>}
        </div>
      ) : (
        <>
          <span>Доступна новая версия {version}</span>
          <div className="update-banner-actions">
            <button onClick={handleInstall}>Обновить</button>
            <button onClick={() => setDismissed(true)} aria-label="Закрыть">✕</button>
          </div>
        </>
      )}
    </div>
  )
}
