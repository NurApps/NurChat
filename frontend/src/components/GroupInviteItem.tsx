import type { GroupInviteResponse } from "../types"

interface Props {
  invite: GroupInviteResponse
  onAccept?: (inviteId: string) => void
  onDecline?: (inviteId: string) => void
}

export default function GroupInviteItem({ invite, onAccept, onDecline }: Props) {
  return (
    <div className="invite-item">
      <div className="invite-body">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2AABEE" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
        </svg>
        <div className="invite-text">
          <span className="invite-title">Приглашение в '{invite.group.name}'</span>
          <span className="invite-from">От {invite.inviter.username}</span>
        </div>
      </div>
      <div className="invite-actions">
        <button className="invite-btn accept" onClick={() => onAccept?.(invite.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Принять
        </button>
        <button className="invite-btn decline" onClick={() => onDecline?.(invite.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Отклонить
        </button>
      </div>
    </div>
  )
}
