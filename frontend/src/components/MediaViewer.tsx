import { useEffect, useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { platform } from "../services/platform"

interface MediaViewerProps {
  type: "image" | "video" | "document"
  url: string
  filename?: string
  fileId?: string
  onClose: () => void
}

export default function MediaViewer({ type, url, filename, fileId, onClose }: MediaViewerProps) {
  const { t } = useTranslation()
  const overlayRef = useRef<HTMLDivElement>(null)
  const [docError, setDocError] = useState(false)
  const [opening, setOpening] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const handleOpenExternal = async () => {
    const token = localStorage.getItem("token")
    if (!token) { setDocError(true); return }
    setOpening(true)
    try {
      await platform.downloadAndOpenFile(url, token, filename || "file")
    } catch (e) {
      console.error("Open file failed:", e)
      setDocError(true)
    } finally {
      setOpening(false)
    }
  }

  const handleDownload = async () => {
    if (fileId && filename) {
      try {
        await api.downloadFile(fileId, filename)
      } catch {
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        a.click()
      }
    } else {
      const a = document.createElement("a")
      a.href = url
      a.download = filename || "file"
      a.click()
    }
  }

  if (type === "image") {
    return (
      <div className="media-viewer-overlay" role="dialog" aria-modal="true" aria-label="Просмотр медиа" ref={overlayRef} onClick={handleOverlayClick}>
        <div className="media-viewer media-viewer-image">
          <button className="media-viewer-close" onClick={onClose} title={t("common.close")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img src={url} alt={filename || t("chat.photo")} className="media-viewer-img" />
          <div className="media-viewer-toolbar">
            {filename && <span className="media-viewer-name">{filename}</span>}
            <button className="media-viewer-action" onClick={handleDownload} title={t("chat.download")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (type === "video") {
    return (
      <div className="media-viewer-overlay" role="dialog" aria-modal="true" aria-label="Просмотр медиа" ref={overlayRef} onClick={handleOverlayClick}>
        <div className="media-viewer media-viewer-video">
          <button className="media-viewer-close" onClick={onClose} title={t("common.close")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <video
            src={url}
            controls
            autoPlay
            className="media-viewer-video-el"
          />
          <div className="media-viewer-toolbar">
            {filename && <span className="media-viewer-name">{filename}</span>}
            <button className="media-viewer-action" onClick={handleDownload} title={t("chat.download")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="media-viewer-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="media-viewer media-viewer-document">
          <button className="media-viewer-close" onClick={onClose} title={t("common.close")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="media-viewer-doc-content">
          <div className="media-viewer-doc-icon">📄</div>
          <p className="media-viewer-doc-name">{filename || t("chat.documentLabel")}</p>
          <div className="media-viewer-doc-actions">
            <button className="media-viewer-btn primary" onClick={handleOpenExternal} disabled={opening}>
              {opening ? t("chat.opening") : t("chat.openInApp")}
            </button>
            <button className="media-viewer-btn" onClick={handleDownload} disabled={opening}>
              {t("chat.download")}
            </button>
          </div>
          {docError && (
            <p className="media-viewer-doc-error">
              {t("errors.openFileFailed")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
