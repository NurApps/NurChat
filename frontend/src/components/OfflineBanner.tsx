import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"

export default function OfflineBanner() {
  const { t } = useTranslation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

import { useTranslation } from "react-i18next"

interface Props {
  isOnline: boolean
  pendingCount: number
}

export default function OfflineBanner({ isOnline, pendingCount }: Props) {
  const { t } = useTranslation()

  if (isOnline && pendingCount === 0) return null

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: "#f44336",
      color: "#fff",
      padding: "8px 16px",
      textAlign: "center",
      fontSize: 13,
      fontWeight: 500,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      {t("common.noInternet")}

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
