import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { WS_BASE, BASE_URL } from "../config"

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

type CallStatus = "connecting" | "ringing" | "active" | "ended" | "missed" | "rejected" | "failed"

async function getToken() {
  const token = localStorage.getItem("token")
  const user = (() => {
    try { return JSON.parse(localStorage.getItem("user") || "null") } catch { return null }
  })()
  return { token, user }
}

async function registerCallDB(targetUserId: string, callType: string): Promise<string | null> {
  const { token } = await getToken()
  if (!token) return null
  try {
    const res = await fetch(`${BASE_URL}/api/calls/start-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_user_id: targetUserId, call_type: callType }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error("[CALL] start-call failed:", text)
      return null
    }
    const data = await res.json()
    return data.call_id || null
  } catch (err) {
    console.error("[CALL] start-call error:", err)
    return null
  }
}

export default function CallPage() {
  const navigate = useNavigate()
  const { userId, type } = useParams()
  const callType = type === "video" ? "video" : "audio"
  const targetUserId = userId || ""

  const [status, setStatus] = useState<CallStatus>("connecting")
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [timer, setTimer] = useState(0)
  const [callId, setCallId] = useState("")
  const [mediaError, setMediaError] = useState<string | null>(null)

  const [targetName, setTargetName] = useState(targetUserId || "Пользователь")
  const avatarChar = targetName[0]?.toUpperCase() || "?"

  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<CallStatus>("connecting")
  const connectedRef = useRef(false)

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current)
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    pcRef.current?.close()
    wsRef.current?.close()
    localStreamRef.current = null
    pcRef.current = null
    wsRef.current = null
  }, [])

  const sendSignaling = useCallback((msg: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const createPeerConnection = useCallback((isInitiator: boolean) => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignaling({ type: "ice-candidate", candidate: e.candidate })
      }
    }

    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0]
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0]
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      console.log("[CALL] PC state:", state)
      if (state === "connected") {
        setStatus("active")
        statusRef.current = "active"
      } else if (state === "failed" || state === "disconnected") {
        if (statusRef.current === "active") {
          setStatus("failed")
          statusRef.current = "failed"
          setTimeout(() => navigate("/chat"), 1500)
        }
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!)
      })
    }

    if (isInitiator) {
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer)
        sendSignaling({ type: "offer", sdp: offer })
      }).catch(console.error)
    }

    return pc
  }, [sendSignaling, navigate])

  const startMedia = useCallback(async () => {
    try {
      const hasDevices = await navigator.mediaDevices.enumerateDevices()
      const hasAudio = hasDevices.some(d => d.kind === "audioinput")
      const hasVideo = hasDevices.some(d => d.kind === "videoinput")

      if (!hasAudio && callType === "audio") {
        setMediaError("Нет доступа к микрофону. Проверьте разрешения.")
        setStatus("failed")
        statusRef.current = "failed"
        return null
      }
      if (callType === "video" && !hasVideo) {
        setMediaError("Нет доступа к камере. Проверьте разрешения.")
        setStatus("failed")
        statusRef.current = "failed"
        return null
      }

      const constraints: MediaStreamConstraints = {
        audio: hasAudio || false,
        video: callType === "video" ? (hasVideo || false) : false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      return stream
    } catch (err: any) {
      console.error("[CALL] Media access error:", err)
      const name = err?.name || ""
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMediaError("Доступ к камере/микрофону запрещён. Разрешите доступ в настройках.")
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setMediaError("Камера или микрофон не найдены.")
      } else if (name === "NotReadableError") {
        setMediaError("Камера/микрофон заняты другим приложением.")
      } else {
        setMediaError("Не удалось получить доступ к камере/микрофону.")
      }
      setStatus("failed")
      statusRef.current = "failed"
      return null
    }
  }, [callType])

  useEffect(() => {
    if (targetUserId) {
      import("../services/api").then(({ api }) => {
        api.getAllUsers().then((users: any[]) => {
          const target = users.find((u: any) => u.id === targetUserId)
          if (target) setTargetName(target.username || target.first_name || "Пользователь")
        }).catch(() => {})
      })
    }
  }, [targetUserId])

  // Подключение к звонку
  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true

    const currentUser = (() => {
      try { return JSON.parse(localStorage.getItem("user") || "null") } catch { return null }
    })()
    const token = localStorage.getItem("token")

    if (!currentUser || !token) {
      setStatus("failed")
      statusRef.current = "failed"
      setMediaError("Не авторизован")
      return
    }

    // Сначала регистрируем звонок в БД через REST (чтобы было логирование)
    registerCallDB(targetUserId, callType).then((registeredCallId) => {
      if (registeredCallId) {
        console.log("[CALL] Registered in DB:", registeredCallId)
      } else {
        console.warn("[CALL] Could not register call in DB, proceeding with WS only")
      }
    })

    const wsUrl = `${WS_BASE}/calls/${currentUser.id}?token=${encodeURIComponent(token)}`
    console.log("[CALL] Connecting to:", wsUrl.replace(token, "***"))
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log("[CALL] WS connected")
      const generatedCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
      setCallId(generatedCallId)

      ws.send(JSON.stringify({
        type: "call-request",
        call_id: generatedCallId,
        target_user_id: targetUserId,
        call_type: callType,
      }))
      setStatus("ringing")
      statusRef.current = "ringing"

      // Таймаут ожидания ответа — 30 секунд
      ringingTimerRef.current = setTimeout(() => {
        if (statusRef.current === "ringing") {
          console.log("[CALL] Ringing timeout")
          sendSignaling({ type: "call-timeout", call_id: generatedCallId })
          setStatus("missed")
          statusRef.current = "missed"
          cleanup()
          setTimeout(() => navigate("/chat"), 1500)
        }
      }, 30000)
    }

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        console.log("[CALL] WS message:", msg.type)

        // При любом ответе отменяем таймаут
        if (ringingTimerRef.current && (msg.type === "call-accepted" || msg.type === "call-rejected" || msg.type === "call-failed" || msg.type === "call-request-sent")) {
          clearTimeout(ringingTimerRef.current)
          ringingTimerRef.current = null
        }

        switch (msg.type) {
          case "call-request-sent":
            break

          case "call-request": {
            const incomingCallId = msg.call_id
            setCallId(incomingCallId)
            setStatus("ringing")
            statusRef.current = "ringing"

            const stream = await startMedia()
            if (!stream) return

            createPeerConnection(false)

            ws.send(JSON.stringify({
              type: "call-accept",
              call_id: incomingCallId,
            }))
            break
          }

          case "call-accepted": {
            clearTimeout(ringingTimerRef.current!)
            ringingTimerRef.current = null
            const stream = await startMedia()
            if (!stream) return
            createPeerConnection(true)
            break
          }

          case "call-rejected":
            setStatus("rejected")
            statusRef.current = "rejected"
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "call-ended":
            setStatus("ended")
            statusRef.current = "ended"
            cleanup()
            setTimeout(() => navigate("/chat"), 500)
            break

          case "call-failed":
            setStatus("failed")
            statusRef.current = "failed"
            setMediaError(msg.message || msg.reason || "Собеседник недоступен")
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "call-timeout":
            setStatus("missed")
            statusRef.current = "missed"
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "offer": {
            const pc = pcRef.current
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({ type: "answer", sdp: answer }))
            }
            break
          }

          case "answer": {
            const pc = pcRef.current
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            }
            break
          }

          case "ice-candidate": {
            const pc = pcRef.current
            if (pc && msg.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
            }
            break
          }
        }
      } catch (err) {
        console.error("[CALL] Signaling message error:", err)
      }
    }

    ws.onerror = (ev: Event) => {
      console.error("[CALL] WS error:", ev)
      setStatus("failed")
      statusRef.current = "failed"
      setMediaError("Ошибка подключения к серверу звонков. Проверьте, запущен ли сервер.")
    }

    ws.onclose = (ev: CloseEvent) => {
      console.log("[CALL] WS closed:", ev.code, ev.reason)
      const currentStatus = statusRef.current
      if (currentStatus === "active" || currentStatus === "ringing") {
        setStatus("failed")
        statusRef.current = "failed"
        setTimeout(() => navigate("/chat"), 1500)
      }
    }

    return cleanup
  }, [])

  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000)
      return () => {
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }
  }, [status])

  const endCall = useCallback(() => {
    sendSignaling({ type: "call-end", call_id: callId })
    setStatus("ended")
    statusRef.current = "ended"
    cleanup()
    setTimeout(() => navigate("/chat"), 500)
  }, [sendSignaling, callId, navigate, cleanup])

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setMicOn(track.enabled)
    }
  }, [])

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      setCamOn(track.enabled)
    }
  }, [])

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => {
      const next = !prev
      const remoteVideo = remoteVideoRef.current
      if (remoteVideo && remoteVideo.srcObject) {
        const stream = remoteVideo.srcObject as MediaStream
        stream.getAudioTracks().forEach((track) => { track.enabled = next })
      }
      return next
    })
  }, [])

  const statusText = () => {
    if (mediaError) return mediaError
    switch (status) {
      case "connecting": return "Установка соединения..."
      case "ringing": return "Звоним..."
      case "active": return "Соединение установлено"
      case "ended": return "Звонок завершён"
      case "missed": return "Пропущенный звонок"
      case "rejected": return "Звонок отклонён"
      case "failed": return mediaError || "Ошибка соединения"
    }
  }

  const renderButtons = () => {
    if (status === "active") {
      return (
        <div className="call-buttons">
          <button className={`call-btn control ${!micOn ? "off" : ""}`} onClick={toggleMic}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {callType === "video" && (
            <button className={`call-btn control ${!camOn ? "off" : ""}`} onClick={toggleCam}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
          )}
          <button className="call-btn end" onClick={endCall}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <button className={`call-btn control ${!speakerOn ? "off" : ""}`} onClick={toggleSpeaker}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        </div>
      )
    }

    return (
      <div className="call-buttons">
        {(status === "ringing" || status === "connecting") && (
          <button className="call-btn end" onClick={endCall}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="call-page">
      <div className="call-header">
        <button className="call-back" onClick={() => { cleanup(); navigate("/chat") }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="call-title">{callType === "audio" ? "Аудиозвонок" : "Видеозвонок"}</span>
      </div>

      <div className="call-body">
        <div className="call-avatar">{avatarChar}</div>
        <h2 className="call-name">{targetName}</h2>
        <p className="call-status">{statusText()}</p>
        {status === "active" && <p className="call-timer">{formatTime(timer)}</p>}

        {callType === "video" && (
          <div className="call-video-container">
            <video
              ref={remoteVideoRef}
              className="call-video-remote"
              autoPlay
              playsInline
            />
            {status === "active" && (
              <video
                ref={localVideoRef}
                className="call-video-local"
                autoPlay
                playsInline
                muted
              />
            )}
          </div>
        )}
      </div>

      {renderButtons()}
    </div>
  )
}
