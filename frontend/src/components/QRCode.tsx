import { useEffect, useRef } from "react"
import QRCodeLib from "qrcode"

interface QRCodeProps {
  data: string
  size?: number
}

/**
 * Настоящий сканируемый QR-код (qrcode lib).
 * Рендерится на canvas через QRCodeLib.toCanvas.
 */
export default function QRCode({ data, size = 200 }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data) return
    QRCodeLib.toCanvas(canvas, data, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
    }).catch((err) => {
      console.error("[QR] render failed:", err)
    })
  }, [data, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 6 }}
    />
  )
}