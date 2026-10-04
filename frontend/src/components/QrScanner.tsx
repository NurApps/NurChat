import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import jsQR from "jsqr"

interface Props {
  onDecode: (text: string) => void
  onClose: () => void
}

/**
 * Сканер QR с камеры (импорт переезда на новом устройстве).
 * Кадр → canvas → jsQR, цикл через rAF. Всё чистим при размонтировании.
 * Требуется secure context (https/localhost/tauri) и разрешение на камеру.
 */
export default function QrScanner({ onDecode, onClose }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState("")
  const doneRef = useRef(false)
  const onDecodeRef = useRef(onDecode)
  onDecodeRef.current = onDecode

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false

    const tick = () => {
      if (stopped || doneRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth
        const h = video.videoHeight
        if (w > 0 && h > 0) {
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d", { willReadFrequently: true })
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            try {
              const img = ctx.getImageData(0, 0, w, h)
              const code = jsQR(img.data, w, h)
              if (code?.data) {
                doneRef.current = true
                onDecodeRef.current(code.data)
                return
              }
            } catch {
              /* ignore bad frames */
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(t("settings.qrNoCameraApi"))
          return
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setError(t("settings.qrCameraDenied"))
      }
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error ? (
        <p className="settings-info-text" style={{ color: "var(--error)" }}>{error}</p>
      ) : (
        <>
          <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 8, background: "#000" }} />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <p className="settings-info-text">{t("settings.qrPointCamera")}</p>
        </>
      )}
      <button type="button" className="settings-action-btn" onClick={onClose}>
        {t("common.cancel")}
      </button>
    </div>
  )
}
