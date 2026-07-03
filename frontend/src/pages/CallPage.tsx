import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { WS_BASE } from "../config"

const SIGNALING_URL = `${WS_BASE}/calls`
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

type CallStatus = "connecting" | "ringing" | "active" | "ended" | "missed" | "rejected" | "failed"

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

  // Resolve target name from contacts/users
  const [targetName, setTargetName] = useState(targetUserId || "Пользователь")
  const avatarChar = targetName[0]?.toUpperCase() || "?"

  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
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
      if (state === "connected") {
        setStatus("active")
      } else if (state === "failed" || state === "disconnected") {
        setStatus("failed")
        setTimeout(() => navigate("/chat"), 1500)
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
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: callType === "video",
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      return stream
    } catch (err) {
      console.error("Media access error:", err)
      setStatus("failed")
      return null
    }
  }, [callType])

  // Resolve target user name
  useEffect(() => {
    if (targetUserId) {
      import("../services/api").then(({ api }) => {
        api.getAllUsers().then((users) => {
          const target = users.find((u: any) => u.id === targetUserId)
          if (target) setTargetName(target.username || target.first_name || "Пользователь")
        }).catch(() => {})
      })
    }
  }, [targetUserId])

  const connectSignaling = useCallback(() => {
    const currentUser = (() => {
      try {
        return JSON.parse(localStorage.getItem("user") || "null")
      } catch {
        return null
      }
    })()
    const token = localStorage.getItem("token")

    if (!currentUser || !token) {
      setStatus("failed")
      return
    }

    const ws = new WebSocket(`${SIGNALING_URL}/${currentUser.id}?token=${encodeURIComponent(token)}`)
    wsRef.current = ws

    ws.onopen = async () => {
      const generatedCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
      setCallId(generatedCallId)

      sendSignaling({
        type: "call-request",
        call_id: generatedCallId,
        target_user_id: targetUserId,
        call_type: callType,
      })
      setStatus("ringing")
    }

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case "call-request-sent":
            break

          case "call-request": {
            const incomingCallId = msg.call_id
            setCallId(incomingCallId)
            setStatus("ringing")

            const stream = await startMedia()
            if (!stream) return

            createPeerConnection(false)

            sendSignaling({
              type: "call-accept",
              call_id: incomingCallId,
            })
            break
          }

          case "call-accepted": {
            const stream = await startMedia()
            if (!stream) return
            createPeerConnection(true)
            break
          }

          case "call-rejected":
            setStatus("rejected")
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "call-ended":
            setStatus("ended")
            cleanup()
            setTimeout(() => navigate("/chat"), 500)
            break

          case "call-failed":
            setStatus("failed")
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "call-timeout":
            setStatus("missed")
            cleanup()
            setTimeout(() => navigate("/chat"), 1500)
            break

          case "offer": {
            const pc = pcRef.current
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              sendSignaling({ type: "answer", sdp: answer })
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
        console.error("Signaling message error:", err)
      }
    }

    ws.onerror = () => {
      setStatus("failed")
    }

    ws.onclose = () => {
      if (status === "active" || status === "ringing") {
        setStatus("failed")
        setTimeout(() => navigate("/chat"), 1500)
      }
    }
  }, [targetUserId, callType, startMedia, createPeerConnection, sendSignaling, navigate, cleanup, status])

  useEffect(() => {
    connectSignaling()
    return cleanup
  }, [connectSignaling, cleanup])

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
      // Mute/unmute remote audio
      const remoteVideo = remoteVideoRef.current
      if (remoteVideo && remoteVideo.srcObject) {
        const stream = remoteVideo.srcObject as MediaStream
        stream.getAudioTracks().forEach((track) => { track.enabled = next })
      }
      return next
    })
  }, [])

  const statusText = () => {
    switch (status) {
      case "connecting": return "Установка соединения..."
      case "ringing": return "Звоним..."
      case "active": return "Соединение установлено"
      case "ended": return "Звонок завершён"
      case "missed": return "Пропущенный звонок"
      case "rejected": return "Звонок отклонён"
      case "failed": return "Ошибка соединения"
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
