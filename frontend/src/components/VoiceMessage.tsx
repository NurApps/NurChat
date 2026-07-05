import { useState, useRef, useEffect } from "react"

interface Props {
  src: string
}

export default function VoiceMessage({ src }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const animRef = useRef<number>(0)
  const barsRef = useRef<number[]>([])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => setDuration(audio.duration)
    const onEnded = () => { setPlaying(false); setProgress(0) }
    audio.addEventListener("loadedmetadata", onLoaded)
    audio.addEventListener("ended", onEnded)
    return () => { audio.removeEventListener("loadedmetadata", onLoaded); audio.removeEventListener("ended", onEnded) }
  }, [])

  // Generate random bars once
  useEffect(() => {
    if (barsRef.current.length === 0) {
      barsRef.current = Array.from({ length: 40 }, () => 0.2 + Math.random() * 0.8)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      const bars = barsRef.current
      const barWidth = w / bars.length
      const gap = 2

      ctx.clearRect(0, 0, w, h)

      bars.forEach((height, i) => {
        const x = i * barWidth
        const barH = height * h * 0.8
        const y = (h - barH) / 2
        const filled = (i / bars.length) * 100 <= progress

        ctx.fillStyle = filled ? "#2AABEE" : "var(--text-secondary, #8e8e93)"
        ctx.beginPath()
        ctx.roundRect(x + gap / 2, y, barWidth - gap, barH, 2)
        ctx.fill()
      })

      if (playing) {
        setProgress((audio.currentTime / audio.duration) * 100 || 0)
        animRef.current = requestAnimationFrame(draw)
      }
    }

    if (playing) {
      animRef.current = requestAnimationFrame(draw)
    } else {
      draw()
    }

    return () => cancelAnimationFrame(animRef.current)
  }, [playing, progress])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
    setPlaying(!playing)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, "0")}`
  }

  return (
    <div className="voice-message">
      <button className="voice-play-btn" onClick={togglePlay}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>
      <canvas ref={canvasRef} width={160} height={32} className="voice-waveform" onClick={togglePlay} />
      <span className="voice-duration">{duration ? formatTime(duration) : "0:00"}</span>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
    </div>
  )
}
