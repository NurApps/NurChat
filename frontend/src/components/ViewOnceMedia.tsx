import { useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { MessageResponse } from "../types"

interface Props {
  message: MessageResponse
  onClose?: () => void
}

export default function ViewOnceMedia({ message, onClose }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [viewed, setViewed] = useState(false)
  const [closing, setClosing] = useState(false)

  const handleOpen = async () => {
    if (loading || viewed) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.markViewOnceViewed(message.id)
      if (res.already_viewed) {
        setViewed(true)
        setClosing(true)
        setTimeout(() => onClose?.(), 1500)
        return
      }
      setContent(res.content)
      setFileId(res.file_id)
      setViewed(true)
      setTimeout(() => {
        setClosing(true)
        setTimeout(() => onClose?.(), 800)
      }, 10000)
    } catch (e: any) {
      setError(e.message || "Error")
    } finally {
      setLoading(false)
    }
  }

  if (closing) {
    return (
      <div className="viewonce-overlay viewonce-closing">
        <div className="viewonce-icon">&#128274;</div>
        <div className="viewonce-text">{t("chat.viewOnceDeleted")}</div>
      </div>
    )
  }

  if (viewed && content) {
    return (
      <div className="viewonce-overlay viewonce-content">
        {message.message_type === "image" && fileId && (
          <img
            src={api.getFileUrl(fileId)}
            alt=""
            style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 8 }}
          />
        )}
        {message.message_type === "video" && fileId && (
          <video
            src={api.getFileUrl(fileId)}
            controls
            autoPlay
            style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 8 }}
          />
        )}
        {message.message_type === "voice" && fileId && (
          <audio src={api.getFileUrl(fileId)} controls autoPlay />
        )}
        {content && content !== "[encrypted]" && message.message_type === "text" && (
          <div className="viewonce-text-content">{content}</div>
        )}
      </div>
    )
  }

  if (viewed) {
    return (
      <div className="viewonce-overlay viewonce-viewed">
        <div className="viewonce-icon">&#128274;</div>
        <div className="viewonce-text">{t("chat.viewOnceDeleted")}</div>
      </div>
    )
  }

  return (
    <div className="viewonce-overlay viewonce-locked" onClick={handleOpen}>
      {loading ? (
        <div className="viewonce-spinner" />
      ) : (
        <>
          <div className="viewonce-icon">&#128274;</div>
          <div className="viewonce-label">{t("chat.viewOnce")}</div>
          <div className="viewonce-hint">{t("chat.viewOnceHint")}</div>
          {error && <div className="viewonce-error">{error}</div>}
        </>
      )}
    </div>
  )
}
