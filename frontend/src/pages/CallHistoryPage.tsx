import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { readStoredUserRaw } from "../services/tokenVault"
import type { UserResponse } from "../types"
import UserAvatar from "../components/UserAvatar"
import { formatTime, formatDateShort, formatFull } from "../utils/format"
import { ArrowLeft, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react"
import { userDisplayName } from "../utils/userName"

interface CallLog {
  id: number
  call_id: string
  caller_id: string
  callee_id: string
  call_type: string
  started_at: string
  ended_at?: string
  duration?: number
  ended_by?: string
  caller?: { id: string; username: string; first_name: string }
  callee?: { id: string; username: string; first_name: string }
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatCallTime(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) {
    return formatTime(ts)
  }
  if (diff < 604800000) {
    return formatTime(ts)
  }
  return formatDateShort(ts)
}

export default function CallHistoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [calls, setCalls] = useState<CallLog[]>([])
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = readStoredUserRaw()
      if (raw) setCurrentUser(JSON.parse(raw))
    } catch {}
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getCallHistory(0, 100)
      setCalls(data.calls)
    } catch (e) {
      console.error("Failed to load call history:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const getOtherUser = (call: CallLog) => {
    if (call.caller_id === currentUser?.id) return call.callee
    return call.caller
  }

  const header = (
    <div className="sidebar-list-header">
      <button className="sidebar-add-btn calls-back" onClick={() => navigate("/chat")}
        title={t("common.back", "Назад")} aria-label={t("common.back", "Назад")}>
        <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      <span className="sidebar-list-title">{t("call.history")}</span>
    </div>
  )

  if (loading) {
    return (
      <div className="calls-page">
        {header}
        <div className="list-empty">{t("common.loading")}</div>
      </div>
    )
  }

  return (
    <div className="calls-page">
      {header}
      <div className="sidebar-list">
        {calls.length === 0 ? (
          <div className="list-empty calls-empty">
            <Phone size={40} strokeWidth={1.5} aria-hidden="true" />
            <p>{t("call.empty")}</p>
          </div>
        ) : (
          <div className="list-scroll">
            {calls.map((call) => {
              const other = getOtherUser(call)
              const wasOutgoing = call.caller_id === currentUser?.id
              const missed = !call.duration
              const isVideo = call.call_type === "video"
              const name = other ? userDisplayName(other) : t("call.unknown")
              const DirIcon = missed ? PhoneMissed : wasOutgoing ? PhoneOutgoing : PhoneIncoming
              const open = () => { if (other) navigate(`/call/${other.id}/${isVideo ? "video" : "audio"}`) }

              return (
                <div
                  key={call.id}
                  className="chat-list-item"
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open() } }}
                >
                  <div className="cli-avatar">
                    {other ? (
                      <UserAvatar id={other.id} username={name} circleClassName="cli-avatar-circle" />
                    ) : (
                      <div className="cli-avatar-circle">?</div>
                    )}
                  </div>
                  <div className="cli-info">
                    <div className="cli-top-row">
                      <div className="cli-name-row">
                        <span className="cli-name">{name}</span>
                      </div>
                      <span className="cli-time" title={formatFull(call.started_at)}>{formatCallTime(call.started_at)}</span>
                    </div>
                    <div className="cli-bottom-row">
                      <span className={`cli-preview calls-status${missed ? " calls-status--missed" : ""}`}>
                        <DirIcon size={14} strokeWidth={2} aria-hidden="true" />
                        {missed ? t("call.missedShort") : formatDuration(call.duration)}
                      </span>
                      {isVideo ? <Video size={14} strokeWidth={2} className="cli-icon" aria-label={t("call.videoShort")} />
                        : <Phone size={14} strokeWidth={2} className="cli-icon" aria-label={t("call.audioShort")} />}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
