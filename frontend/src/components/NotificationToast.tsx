import { useEffect } from "react"

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
    <div className="toast-notification" onClick={() => onClick?.(toast.chatId)}>
      <div className="toast-content">
        <strong className="toast-title">{toast.title}</strong>
        <span className="toast-body">{toast.body}</span>
      </div>
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
