import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import type { FileUploadResponse } from "../types"
import { ArrowLeft, FileText, Folder, Image, Mic, Music2, Video } from "lucide-react"

interface Props {
  onClose: () => void
}

const FILE_ICONS = {
  image: Image,
  video: Video,
  audio: Music2,
  voice: Mic,
  document: FileText,
  all: Folder,
} as const

const FileIcon = ({ type }: { type: string }) => {
  const Icon = FILE_ICONS[type as keyof typeof FILE_ICONS] || FileText
  return <Icon size={18} strokeWidth={2} aria-hidden="true" />
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
    if (!Number.isFinite(bytes) || bytes < 0) return "—"
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
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
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
            <FileIcon type={ft.key} />
          </button>
        ))}
      </div>
      <div className="fm-inline-list">
        {loading && <p className="fm-inline-empty">{t("files.loading")}</p>}
        {!loading && filtered.length === 0 && <p className="fm-inline-empty">{t("files.empty")}</p>}
        {!loading && filtered.map((file) => (
          <div key={file.id} className="fm-inline-item" onClick={() => api.downloadFile(file.id, file.filename)}>
            <span className="fm-inline-icon"><FileIcon type={file.file_type} /></span>
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
