import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { platform } from "../services/platform"
import { X } from "lucide-react"

export default function UpdateBanner() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)
  const [releaseUrl, setReleaseUrl] = useState("")
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!platform.isTauri) return
    const timer = setTimeout(async () => {
      const info = await platform.checkForUpdates()
      if (info?.has_update) {
        setVersion(info.latest_version)
        setReleaseUrl(info.url)
      }
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  if (!platform.isTauri || !version || dismissed) return null

  return (
    <div className="update-banner">
      <span>{t("updates.newVersion", { version })}</span>
      <div className="update-banner-actions">
        <button onClick={() => platform.openExternal(releaseUrl)}>{t("updates.install")}</button>
        <button onClick={() => setDismissed(true)} aria-label={t("updates.close")}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
