import { useState, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"

interface Props {
  onUploaded: (fileId: string, fileType: string, filename: string) => void
  onError?: (error: string) => void
  disabled?: boolean
}

type UploadState = "idle" | "uploading" | "success" | "error"

export default function FileUploadProgress({ onUploaded, onError, disabled }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<UploadState>("idle")
  const [progress, setProgress] = useState(0)
  const [filename, setFilename] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const getFileType = (file: File): string => {
    if (file.type.startsWith("image/")) return "image"
    if (file.type.startsWith("video/")) return "video"
    if (file.type.startsWith("audio/")) return "audio"
    return "document"
  }

  const handleUpload = useCallback(async (file: File) => {
    setState("uploading")
    setProgress(0)
    setFilename(file.name)
    setErrorMsg("")

    try {
      const result = await api.uploadFile(file, getFileType(file), (p) => setProgress(p))
      setState("success")
      onUploaded(result.id, getFileType(file), file.name)
      setTimeout(() => {
        setState("idle")
        setProgress(0)
      }, 1500)
    } catch (e: any) {
      setState("error")
      const msg = e.message || t("errors.uploadFailed")
      setErrorMsg(msg)
      onError?.(msg)
    }
  }, [onUploaded, onError, t])

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUpload(file)
      e.target.value = ""
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        style={{ display: "none" }}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
      />

      {state === "idle" && (
        <button
          className="ch-btn"
          onClick={handleClick}
          disabled={disabled}
          title={t("chat.attachFile")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
      )}

      {state === "uploading" && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          marginBottom: 8,
          background: "var(--bg)",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          minWidth: 200,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
              {filename}
            </span>
            <span style={{ fontSize: 12, color: "var(--tg-blue)" }}>{progress}%</span>
          </div>
          <div style={{
            height: 4,
            background: "var(--input-bg)",
            borderRadius: 2,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--tg-blue)",
              borderRadius: 2,
              transition: "width 0.2s",
            }} />
          </div>
        </div>
      )}

      {state === "success" && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          marginBottom: 8,
          background: "var(--bg)",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          color: "#4CAF50",
          fontSize: 13,
          textAlign: "center",
        }}>
          ✓ {t("chat.uploaded")}
        </div>
      )}

      {state === "error" && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          marginBottom: 8,
          background: "var(--bg)",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          color: "#f44336",
          fontSize: 12,
        }}>
          {errorMsg}
        </div>
      )}
    </div>
  )
}
