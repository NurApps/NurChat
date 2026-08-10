import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { ContactRequestResponse } from "../types"
import { api } from "../services/api"
import { getAvatarColor } from "../utils/avatar"
import { formatRelativeTime } from "../utils/format"

interface Props {
  onClose: () => void
}

export default function ContactRequests({ onClose }: Props) {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<ContactRequestResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"incoming" | "sent">("incoming")

  useEffect(() => {
    loadRequests()
  }, [tab])

  const loadRequests = async () => {
    setLoading(true)
    try {
      if (tab === "incoming") {
        const data = await api.getIncomingContactRequests()
        setRequests(data)
      } else {
        const data = await api.getSentContactRequests()
        setRequests(data)
      }
    } catch (e) {
      console.error("Failed to load requests:", e)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async (id: string) => {
    try {
      await api.acceptContactRequest(id)
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "accepted" as const } : r))
    } catch (e) {
      console.error("Failed to accept:", e)
    }
  }

  const handleReject = async (id: string) => {
    try {
      await api.rejectContactRequest(id)
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" as const } : r))
    } catch (e) {
      console.error("Failed to reject:", e)
    }
  }

  return (
    <div className="contact-requests-modal" onClick={onClose}>
      <div className="contact-requests-content" onClick={e => e.stopPropagation()}>
        <div className="contact-requests-header">
          <h3>{t("contacts.requests")}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="contact-requests-tabs">
          <button
            className={`tab ${tab === "incoming" ? "active" : ""}`}
            onClick={() => setTab("incoming")}
          >
            {t("contacts.incoming")}
          </button>
          <button
            className={`tab ${tab === "sent" ? "active" : ""}`}
            onClick={() => setTab("sent")}
          >
            {t("contacts.sent")}
          </button>
        </div>

        <div className="contact-requests-list">
          {loading ? (
            <div className="loading">{t("common.loading")}</div>
          ) : requests.length === 0 ? (
            <div className="empty">{t("contacts.noRequests")}</div>
          ) : (
            requests.map(req => {
              const user = tab === "incoming" ? req.from_user : req.to_user
              return (
                <div key={req.id} className="contact-request-item">
                  <div
                    className="cr-avatar"
                    style={{ backgroundColor: getAvatarColor(user.id) }}
                  >
                    {user.username?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="cr-info">
                    <span className="cr-name">{user.first_name || user.username}</span>
                    <span className="cr-time">{formatRelativeTime(req.created_at)}</span>
                    {req.message && <span className="cr-message">{req.message}</span>}
                  </div>
                  <div className="cr-actions">
                    {req.status === "pending" && tab === "incoming" ? (
                      <>
                        <button className="cr-accept" onClick={() => handleAccept(req.id)}>
                          {t("common.accept")}
                        </button>
                        <button className="cr-reject" onClick={() => handleReject(req.id)}>
                          {t("common.reject")}
                        </button>
                      </>
                    ) : (
                      <span className={`cr-status cr-status-${req.status}`}>
                        {t(`contacts.status.${req.status}`)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
