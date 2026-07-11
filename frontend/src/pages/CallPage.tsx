import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { WS_BASE, BASE_URL } from "../config"
import { api } from "../services/api"

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
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
    if (!res.ok) return null
    const data = await res.json()
    return data.call_id || null
  } catch {
    return null
  }
}

export default function CallPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { userId, type } = useParams()
  const [searchParams] = useSearchParams()
  const callType = type === "video" ? "video" : "audio"
  const targetUserId = userId || ""

  const incomingCallId = searchParams.get("call_id")
  const isIncoming = !!incomingCallId

  const [status, setStatus] = useState<CallStatus>("connecting")
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [timer, setTimer] = useState(0)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(DEFAULT_ICE_SERVERS)

  const [targetName, setTargetName] = useState(targetUserId || t("call.audioCall"))
  const avatarChar = targetName[0]?.toUpperCase() || "?"

  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<CallStatus>("connecting")
  const connectedRef = useRef(false)
  const pendingSignalsRef = useRef<{ type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }[]>([])
  const callIdRef = useRef(incomingCallId || "")
  const wsReconnectRef = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({ attempt: 0, timer: null })

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current)
    if (wsReconnectRef.current.timer) clearTimeout(wsReconnectRef.current.timer)
    wsReconnectRef.current.attempt = 0
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    pcRef.current?.close()
    wsRef.current?.close()
    localStreamRef.current = null
    pcRef.current = null
    wsRef.current = null
    remoteStreamRef.current = null
  }, [])

  const sendSignaling = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const processPendingSignals = useCallback(async () => {
    const pc = pcRef.current
    if (!pc) return
    const pending = pendingSignalsRef.current
    pendingSignalsRef.current = []

    for (const msg of pending) {
      try {
        switch (msg.type) {
          case "offer": {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp!))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sendSignaling({ type: "answer", sdp: answer })
            break
          }
          case "answer":
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp!))
            break
          case "ice-candidate":
            if (msg.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
            }
            break
        }
      } catch (err) {
        console.error("[CALL] Error processing pending signal:", err)
      }
    }
  }, [sendSignaling])

  const createPeerConnection = useCallback((isInitiator: boolean) => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({ iceServers })
    pcRef.current = pc

    console.log("[CALL] PC created, isInitiator:", isInitiator)

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignaling({ type: "ice-candidate", candidate: e.candidate })
      }
    }

    pc.ontrack = (e) => {
      console.log("[CALL] Remote track received")
      remoteStreamRef.current = e.streams[0]
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0]
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0]
      }
    }

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState
      console.log("[CALL] ICE state:", iceState)
      if (iceState === "disconnected") {
        console.log("[CALL] ICE disconnected, attempting restart...")
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            pc.restartIce()
            pc.createOffer({ iceRestart: true }).then((offer) => {
              pc.setLocalDescription(offer)
              sendSignaling({ type: "offer", sdp: offer })
              console.log("[CALL] ICE restart offer sent")
            }).catch((err) => console.error("[CALL] ICE restart failed:", err))
          }
        }, 2000)
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      console.log("[CALL] PC state:", state)
      if (state === "connected") {
        setStatus("active")
        statusRef.current = "active"
      } else if (state === "failed") {
        setStatus("failed")
        statusRef.current = "failed"
        setMediaError(t("call.connBroken"))
        cleanup()
        setTimeout(() => navigate("/chat"), 1500)
      } else if (state === "disconnected") {
        console.log("[CALL] PC disconnected, waiting for ICE restart...")
      } else if (state === "closed") {
        if (statusRef.current === "active") {
          setStatus("failed")
          statusRef.current = "failed"
          setMediaError(t("call.connBroken"))
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

    processPendingSignals()

    return pc
  }, [sendSignaling, navigate, cleanup, processPendingSignals, iceServers, t])

  const startMedia = useCallback(async () => {
    try {
      const hasDevices = await navigator.mediaDevices.enumerateDevices()
      const hasAudio = hasDevices.some(d => d.kind === "audioinput")
      const hasVideo = hasDevices.some(d => d.kind === "videoinput")

      if (!hasAudio && callType === "audio") {
        setMediaError(t("call.noMic"))
        setStatus("failed")
        statusRef.current = "failed"
        return null
      }
      if (callType === "video" && !hasVideo) {
        setMediaError(t("call.noCam"))
        setStatus("failed")
        statusRef.current = "failed"
        return null
      }

      const constraints: MediaStreamConstraints = {
        audio: hasAudio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
        video: callType === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      return stream
    } catch (err: unknown) {
      console.error("[CALL] Media access error:", err)
      const name = (err && typeof err === "object" && "name" in err) ? (err as {name: string}).name : ""
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMediaError(t("call.permDenied"))
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setMediaError(t("call.deviceNotFound"))
      } else if (name === "NotReadableError") {
        setMediaError(t("call.deviceBusy"))
      } else {
        setMediaError(t("call.mediaFailed"))
      }
      setStatus("failed")
      statusRef.current = "failed"
      return null
    }
  }, [callType, t])

  useEffect(() => {
    if (targetUserId) {
      import("../services/api").then(({ api }) => {
        api.getAllUsers().then((users: { id: string; username?: string; first_name?: string }[]) => {
          const target = users.find((u) => u.id === targetUserId)
          if (target) setTargetName(target.username || target.first_name || t("call.audioCall"))
        }).catch(() => {})
      })
    }
  }, [targetUserId, t])

  useEffect(() => {
    api.getIceServers().then(({ ice_servers }) => {
      if (ice_servers && ice_servers.length > 0) {
        setIceServers(ice_servers)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true

    const currentUser = (() => {
      try { return JSON.parse(localStorage.getItem("user") || "null") } catch { return null }
    })()
    const token = localStorage.getItem("token")

    if (!currentUser || !token) {
      statusRef.current = "failed"
      connectedRef.current = true
      setTimeout(() => {
        setStatus("failed")
        setMediaError(t("call.notAuthorized"))
      }, 0)
      return
    }

    if (!isIncoming) {
      registerCallDB(targetUserId, callType)
    }

    let reconnectAttempts = 0
    const MAX_RECONNECT = 5

    function connectWs() {
      const wsUrl = `${WS_BASE}/calls/${currentUser!.id}?token=${encodeURIComponent(token!)}`
      console.log("[CALL] Connecting to:", wsUrl.replace(token!, "***"))
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log("[CALL] WS connected, isIncoming:", isIncoming)
        reconnectAttempts = 0

        if (isIncoming) {
          callIdRef.current = incomingCallId!
          setStatus("ringing")
          statusRef.current = "ringing"

          ws.send(JSON.stringify({
            type: "call-join",
            call_id: incomingCallId,
          }))

          startMedia().then((stream) => {
            if (stream) {
              createPeerConnection(false)
            }
          })

          ringingTimerRef.current = setTimeout(() => {
            if (statusRef.current === "ringing") {
              console.log("[CALL] Incoming call timeout")
              setStatus("missed")
              statusRef.current = "missed"
              cleanup()
              setTimeout(() => navigate("/chat"), 1500)
            }
          }, 30000)
        } else {
          const generatedCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`
          callIdRef.current = generatedCallId

          ws.send(JSON.stringify({
            type: "call-request",
            call_id: generatedCallId,
            target_user_id: targetUserId,
            call_type: callType,
          }))
          setStatus("ringing")
          statusRef.current = "ringing"

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
      }

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)
          console.log("[CALL] WS message:", msg.type)

          if (ringingTimerRef.current && (msg.type === "call-accepted" || msg.type === "call-rejected" || msg.type === "call-failed" || msg.type === "call-request-sent")) {
            clearTimeout(ringingTimerRef.current)
            ringingTimerRef.current = null
          }

          switch (msg.type) {
            case "call-request-sent":
              break

            case "call-request": {
              const incomingCallIdMsg = msg.call_id
              callIdRef.current = incomingCallIdMsg
              setStatus("ringing")
              statusRef.current = "ringing"

              const stream = await startMedia()
              if (!stream) return

              createPeerConnection(false)

              ws.send(JSON.stringify({
                type: "call-accept",
                call_id: incomingCallIdMsg,
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
              setMediaError(msg.message || msg.reason || t("call.peerUnavailable"))
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
              } else {
                console.log("[CALL] Offer received before PC ready, queuing")
                pendingSignalsRef.current.push(msg)
              }
              break
            }

            case "answer": {
              const pc = pcRef.current
              if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
              } else {
                pendingSignalsRef.current.push(msg)
              }
              break
            }

            case "ice-candidate": {
              const pc = pcRef.current
              if (pc && msg.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
              } else if (msg.candidate) {
                pendingSignalsRef.current.push(msg)
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
        setMediaError(t("call.wsError"))
      }

      ws.onclose = (ev: CloseEvent) => {
        console.log("[CALL] WS closed:", ev.code, ev.reason)
        const currentStatus = statusRef.current

        if (currentStatus === "active" || currentStatus === "ringing" || currentStatus === "connecting") {
          if (reconnectAttempts < MAX_RECONNECT) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
            reconnectAttempts++
            console.log(`[CALL] WS reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT} in ${delay}ms`)
            wsReconnectRef.current.timer = setTimeout(connectWs, delay)
            return
          }

          if (ev.code === 4001) {
            setMediaError(t("call.authError"))
          } else if (ev.code === 1006) {
            setMediaError(t("call.connLost"))
          } else if (ev.code !== 1000) {
            setMediaError(t("call.connClosed"))
          }
          setStatus("failed")
          statusRef.current = "failed"
          setTimeout(() => navigate("/chat"), 1500)
        }
      }
    }

    connectWs()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000)
      return () => {
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }
  }, [status])

  const endCall = useCallback(() => {
    sendSignaling({ type: "call-end", call_id: callIdRef.current })
    setStatus("ended")
    statusRef.current = "ended"
    cleanup()
    setTimeout(() => navigate("/chat"), 500)
  }, [sendSignaling, navigate, cleanup])

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
    const next = !speakerOn
    setSpeakerOn(next)

    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !next
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !next
    }
    if (!remoteVideoRef.current && !remoteAudioRef.current && remoteStreamRef.current) {
      remoteStreamRef.current.getAudioTracks().forEach((track) => { track.enabled = next })
    }
  }, [speakerOn])

  const toggleScreenShare = useCallback(async () => {
    if (!pcRef.current || callType !== "video") return
    
    try {
      if (screenSharing) {
        // Stop screen sharing - restore camera
        const screenTrack = localStreamRef.current?.getTracks().find(t => t.kind === "video" && t.label.includes("screen"))
        if (screenTrack) {
          screenTrack.stop()
          localStreamRef.current?.removeTrack(screenTrack)
          pcRef.current.getSenders().forEach(sender => {
            if (sender.track === screenTrack) {
              pcRef.current?.removeTrack(sender)
            }
          })
        }
        
        // Re-enable camera track if it exists
        const cameraTrack = localStreamRef.current?.getTracks().find(t => t.kind === "video" && !t.label.includes("screen"))
        if (cameraTrack) {
          cameraTrack.enabled = true
        }
        
        setScreenSharing(false)
        setCamOn(true)
      } else {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" } as MediaTrackConstraints, 
          audio: false 
        })
        
        const screenTrack = screenStream.getVideoTracks()[0]
        if (screenTrack && pcRef.current) {
          // Disable camera track
          const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
          if (cameraTrack) {
            cameraTrack.enabled = false
          }
          
          // Add screen track to peer connection
          pcRef.current.addTrack(screenTrack, screenStream)
          
          // Add to local stream for preview
          localStreamRef.current?.addTrack(screenTrack)
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current
          }
          
          screenTrack.onended = () => {
            toggleScreenShare()
          }
          
          setScreenSharing(true)
          setCamOn(false)
        }
      }
    } catch (err) {
      console.error("[CALL] Screen share error:", err)
      setMediaError(t("call.screenShareFailed"))
    }
  }, [screenSharing, callType, t])

  const statusText = () => {
    if (mediaError) return mediaError
    switch (status) {
      case "connecting": return t("call.connecting")
      case "ringing": return isIncoming ? t("call.incoming") : t("call.ringing")
      case "active": return t("call.active")
      case "ended": return t("call.ended")
      case "missed": return t("call.missed")
      case "rejected": return t("call.rejected")
      case "failed": return mediaError || t("call.failed")
    }
  }

  const renderButtons = () => {
    if (status === "active") {
      return (
        <div className="call-buttons">
          <button className={`call-btn control ${!micOn ? "off" : ""}`} onClick={toggleMic} title={t("call.mic")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {callType === "video" && (
            <>
              <button className={`call-btn control ${!camOn || screenSharing ? "off" : ""}`} onClick={toggleCam} title={t("call.camera")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </button>
              <button className={`call-btn control ${screenSharing ? "on" : ""}`} onClick={toggleScreenShare} title={t("call.screenShare")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>
            </>
          )}
          <button className="call-btn end" onClick={endCall}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <button className={`call-btn control ${!speakerOn ? "off" : ""}`} onClick={toggleSpeaker} title={t("call.speaker")}>
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
        <span className="call-title">{callType === "audio" ? t("call.audioCall") : t("call.videoCall")}</span>
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

        {callType === "audio" && (
          <audio
            ref={remoteAudioRef}
            autoPlay
            playsInline
            hidden
          />
        )}
      </div>

      {renderButtons()}
    </div>
  )
}
