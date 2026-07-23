import { useState, useEffect } from "react"
import { checkForUpdates } from "../services/updateService"
import { open } from "@tauri-apps/plugin-shell"

export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      const result = await checkForUpdates()
      if (result?.has_update) {
        setUpdateInfo({ version: result.latest_version, url: result.url })
      }
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  if (!updateInfo || dismissed) return null

  return (
    <div className="update-banner">
      <span>Доступна версия {updateInfo.version}</span>
      <div className="update-banner-actions">
        <button onClick={() => open(updateInfo.url)}>Обновить</button>
        <button onClick={() => setDismissed(true)}>✕</button>
      </div>
    </div>
  )
}
