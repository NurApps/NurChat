import { useEffect } from "react"
import { X } from "lucide-react"

interface ToastData {
  id: string
  title: string
  body: string
  chatId?: string
}

interface Props {
  toast: ToastData | null
  onClose: () => void
  onClick?: (chatId?: string) => void
}

export default function NotificationToast({ toast, onClose, onClick }: Props) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [toast, onClose])

  if (!toast) return null

  return (
    <div className="toast-notification" role="status" aria-live="polite" onClick={() => onClick?.(toast.chatId)}>
      <div className="toast-content">
        <strong className="toast-title">{toast.title}</strong>
        <span className="toast-body">{toast.body}</span>
      </div>
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onClose() }}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
