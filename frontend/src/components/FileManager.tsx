import { useState, useEffect, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { FileUploadResponse } from "../types"

interface Props {
  onClose: () => void
}

const FILE_ICONS: Record<string, ReactNode> = {
  image: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>,
  video: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>,
  audio: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>,
  voice: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>,
  document: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
  all: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
}

export default function FileManager({ onClose }: Props) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileUploadResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")

  useEffect(() => {
    loadFiles()
  }, [])

  const loadFiles = async () => {
    try {
      const allFiles = await api.getMyFiles()
      setFiles(allFiles || [])
    } catch (e) {
      console.error("Load files failed:", e)
    } finally {
      setLoading(false)
    }
  }

  const filtered = filter === "all" ? files : files.filter(f => f.file_type === filter)

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} ${t("files.sizeB")}`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} ${t("files.sizeKB")}`
    return `${(bytes / 1048576).toFixed(1)} ${t("files.sizeMB")}`
  }

  const fileTypes = [
    { key: "all", label: t("chat.all") },
    { key: "image", label: t("chat.photo") },
    { key: "video", label: t("chat.video") },
    { key: "audio", label: t("chat.audio") },
    { key: "voice", label: t("chat.voice") },
    { key: "document", label: t("chat.document") },
  ]

  return (
    <div className="file-manager-inline">
      <div className="fm-inline-header">
        <button className="fm-back-btn" onClick={onClose} title={t("common.back")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="fm-inline-title">{t("chat.files")}</span>
      </div>
      <div className="fm-inline-filters">
        {fileTypes.map((ft) => (
          <button
            key={ft.key}
            className={`fm-filter-btn ${filter === ft.key ? "active" : ""}`}
            onClick={() => setFilter(ft.key)}
            title={ft.label}
          >
            {FILE_ICONS[ft.key]}
          </button>
        ))}
      </div>
      <div className="fm-inline-list">
        {loading && <p className="fm-inline-empty">{t("files.loading")}</p>}
        {!loading && filtered.length === 0 && <p className="fm-inline-empty">{t("files.empty")}</p>}
        {!loading && filtered.map((file) => (
          <div key={file.id} className="fm-inline-item" onClick={() => api.downloadFile(file.id, file.filename)}>
            <span className="fm-inline-icon">{FILE_ICONS[file.file_type] || FILE_ICONS.document}</span>
            <div className="fm-inline-info">
              <span className="fm-inline-name">{file.filename}</span>
              <span className="fm-inline-meta">{formatSize(file.file_size)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
