import { useTranslation } from "react-i18next"
import { getAvatarColor } from "../utils/avatar"
import type { ContactResponse } from "../types"
import { MessageCircle, Trash2 } from "lucide-react"

interface Props {
  contact: ContactResponse
  onRemove?: (contactId: string) => void
  onStartChat?: (userId: string) => void
}

export default function ContactListItem({ contact, onRemove, onStartChat }: Props) {
  const { t } = useTranslation()
  const username = contact.contact_user.username
  const initial = username[0]?.toUpperCase() || "?"

  return (
    <div className="contact-list-item">
      <div className="cli-avatar">
        <div className="cli-avatar-circle" style={{ background: getAvatarColor(contact.contact_user.id) }}>
          <span>{initial}</span>
        </div>
      </div>
      <div className="contact-info">
        <span className="contact-name">{username}</span>
        <span className="contact-subtitle">{t("chat.contacts")}</span>
      </div>
      <div className="contact-actions">
        <button className="contact-action-btn" title={t("chat.write")} onClick={() => onStartChat?.(contact.contact_user.id)}>
          <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button className="contact-action-btn danger" title={t("common.delete")} onClick={() => onRemove?.(contact.id)}>
          <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
