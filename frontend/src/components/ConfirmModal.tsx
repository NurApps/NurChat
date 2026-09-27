import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  title: string
  icon?: ReactNode
  message: string
  warning?: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmModal({ title, icon, message, warning, confirmLabel, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header with-icon">
          <h3>{icon}{title}</h3>
        </div>
        <div className="modal-body">
          <p>{message}</p>
          {warning && <p>{warning}</p>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn cancel" onClick={onClose}>{t("common.cancel")}</button>
          <button className="modal-btn danger" onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel || t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  )
}
