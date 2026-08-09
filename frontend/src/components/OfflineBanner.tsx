import { useTranslation } from "react-i18next"

interface Props {
  isOnline: boolean
  pendingCount: number
}

export default function OfflineBanner({ isOnline, pendingCount }: Props) {
  const { t } = useTranslation()

  if (isOnline && pendingCount === 0) return null

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
        padding: "8px 16px",
        textAlign: "center",
        fontSize: 13,
        fontWeight: 500,
        background: isOnline ? "#1a472a" : "#4a1c1c",
        color: isOnline ? "#4ade80" : "#f87171",
        borderBottom: `1px solid ${isOnline ? "#2d6a4f" : "#6b2b2b"}`,
        transition: "all 0.3s ease",
      }}
    >
      {isOnline
        ? pendingCount > 0
          ? t("common.syncing", { count: pendingCount })
          : t("common.backOnline")
        : t("common.offlineMode")}
    </div>
  )
}
