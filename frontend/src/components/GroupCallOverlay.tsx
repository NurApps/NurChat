import { useState, useEffect, useCallback, useRef } from "react"
import {
  startGroupCall,
  joinGroupCall,
  leaveGroupCall,
  endGroupCall,
  toggleMute as svcToggleMute,
  toggleVideo as svcToggleVideo,
  onGroupCallEvent,
  getGroupCallInfo,
  type Participant,
} from "../services/groupCallService"
import { useTranslation } from "react-i18next"
import "../styles/call.css"

interface GroupCallOverlayProps {
  chatId: string
  isGroup: boolean
  onClose: () => void
}

export default function GroupCallOverlay({ chatId, isGroup, onClose }: GroupCallOverlayProps) {
  const { t } = useTranslation()
  const [callId, setCallId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<"idle" | "joining" | "active" | "ended">("idle")
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())

  const updateParticipantStreams = useCallback(() => {
    const info = getGroupCallInfo()
    if (!info) return
    setParticipants(new Map(info.participants))
    setLocalStream(info.localStream)
  }, [])

  useEffect(() => {
    const unsub = onGroupCallEvent((event) => {
      switch (event.type) {
        case "call_joined":
          setStatus("active")
          updateParticipantStreams()
          break
        case "call_ended":
          setStatus("ended")
          setTimeout(onClose, 1500)
          break
        case "participant_joined":
        case "participant_left":
        case "participant_muted":
        case "participant_video_toggle":
          updateParticipantStreams()
          break
      }
    })
    return unsub
  }, [onClose, updateParticipantStreams])

  useEffect(() => {
    for (const [userId, participant] of participants) {
      const videoEl = videoRefs.current.get(userId)
      if (videoEl && participant.stream) {
        videoEl.srcObject = participant.stream
      }
    }
  }, [participants])

  const localVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && localStream) {
      el.srcObject = localStream
    }
  }, [localStream])

  const handleStart = async (callType: "audio" | "video") => {
    if (!isGroup) return
    setStatus("joining")
    try {
      const id = await startGroupCall(chatId, callType)
      setCallId(id)
    } catch {
      setStatus("idle")
    }
  }

  const handleJoin = async (id: string) => {
    setStatus("joining")
    try {
      await joinGroupCall(id)
      setCallId(id)
    } catch {
      setStatus("idle")
    }
  }

  const handleLeave = async () => {
    await leaveGroupCall()
    onClose()
  }

  const handleEnd = async () => {
    await endGroupCall()
    onClose()
  }

  const handleToggleMute = () => {
    const muted = svcToggleMute()
    setIsMuted(muted)
  }

  const handleToggleVideo = () => {
    const off = svcToggleVideo()
    setIsVideoOff(off)
  }

  if (status === "idle") {
    return (
      <div className="call-overlay">
        <div className="call-controls">
          <button className="call-btn call-btn-audio" onClick={() => handleStart("audio")}>
            {t("calls.startAudioCall", "Аудиозвонок")}
          </button>
          <button className="call-btn call-btn-video" onClick={() => handleStart("video")}>
            {t("calls.startVideoCall", "Видеозвонок")}
          </button>
          <button className="call-btn call-btn-cancel" onClick={onClose}>
            {t("common.cancel", "Отмена")}
          </button>
        </div>
      </div>
    )
  }

  if (status === "ended") {
    return (
      <div className="call-overlay">
        <div className="call-status">{t("calls.ended", "Звонок завершён")}</div>
      </div>
    )
  }

  const participantArray = Array.from(participants.values())
  const totalParticipants = participantArray.length + 1

  return (
    <div className="call-overlay group-call-overlay">
      <div className="group-call-grid" data-count={totalParticipants}>
        <div className="call-participant local">
          {localStream && !isVideoOff && (
            <video ref={localVideoRef} autoPlay muted playsInline className="call-video" />
          )}
          <div className="participant-label">
            {t("calls.you", "Вы")}
            {isMuted && <span className="muted-icon">🔇</span>}
          </div>
        </div>

        {participantArray.map((p) => (
          <div key={p.userId} className="call-participant remote">
            {p.stream && !p.isVideoOff && (
              <video
                ref={(el) => {
                  if (el) {
                    videoRefs.current.set(p.userId, el)
                    el.srcObject = p.stream
                  }
                }}
                autoPlay
                playsInline
                className="call-video"
              />
            )}
            <div className="participant-label">
              {p.username || p.userId.slice(0, 8)}
              {p.isMuted && <span className="muted-icon">🔇</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="call-controls">
        <button
          className={`call-btn ${isMuted ? "call-btn-muted" : ""}`}
          onClick={handleToggleMute}
        >
          {isMuted ? t("calls.unmute", "Вкл. микрофон") : t("calls.mute", "Выкл. микрофон")}
        </button>
        <button
          className={`call-btn ${isVideoOff ? "call-btn-video-off" : ""}`}
          onClick={handleToggleVideo}
        >
          {isVideoOff ? t("calls.videoOn", "Вкл. видео") : t("calls.videoOff", "Выкл. видео")}
        </button>
        {totalParticipants > 1 && (
          <button className="call-btn call-btn-end" onClick={handleEnd}>
            {t("calls.endForAll", "Завершить для всех")}
          </button>
        )}
        <button className="call-btn call-btn-cancel" onClick={handleLeave}>
          {t("calls.leave", "Покинуть")}
        </button>
      </div>
    </div>
  )
}
