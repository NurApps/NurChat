import type { ContactResponse } from "../types"

interface Props {
  contact: ContactResponse
  onRemove?: (contactId: string) => void
  onStartChat?: (userId: string) => void
}

export default function ContactListItem({ contact, onRemove, onStartChat }: Props) {
  const username = contact.contact_user.username
  const initial = username[0]?.toUpperCase() || "?"

  return (
    <div className="contact-list-item">
      <div className="cli-avatar">
        <div className="cli-avatar-circle" style={{ background: "#2AABEE" }}>
          <span>{initial}</span>
        </div>
      </div>
      <div className="contact-info">
        <span className="contact-name">{username}</span>
        <span className="contact-subtitle">В контактах</span>
      </div>
      <div className="contact-actions">
        <button className="contact-action-btn" title="Написать" onClick={() => onStartChat?.(contact.contact_user.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button className="contact-action-btn danger" title="Удалить" onClick={() => onRemove?.(contact.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
