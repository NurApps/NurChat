import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  isOnline: boolean
  pendingCount: number
}

export default function OfflineBanner({ isOnline, pendingCount }: Props) {
  const { t } = useTranslation()
  // Короткая задержка перед показом: сокет переподключается за миллисекунды
  // (token refresh, мгновенный retry), и мигание плашки на каждый чих туннеля
  // раздражает сильнее, чем сам факт обрыва.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isOnline && pendingCount === 0) {
      setVisible(false)
      return
    }
    const id = setTimeout(() => setVisible(true), 600)
    return () => clearTimeout(id)
  }, [isOnline, pendingCount])

  if (!visible) return null

  // Спокойный нейтральный стиль вместо «красной плашки ошибки»: статус
  // «соединение…», а не авария — интерфейс продолжает работать на кэше.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "7px 16px",
        textAlign: "center",
        fontSize: 13,
        fontWeight: 500,
        background: "#2b2f36",
        color: "#c9d1d9",
        borderBottom: "1px solid #3a4048",
        transition: "all 0.3s ease",
      }}
    >
      {!isOnline && (
        <>
          <style>{`@keyframes nurchat-banner-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }`}</style>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#8b949e",
              animation: "nurchat-banner-pulse 1.6s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        </>
      )}
      {isOnline
        ? pendingCount > 0
          ? t("common.syncing", { count: pendingCount })
          : t("common.backOnline")
        : t("common.connecting")}
    </div>
  )
}
