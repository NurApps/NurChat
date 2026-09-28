import { useTranslation } from "react-i18next"
import type { GroupInviteResponse } from "../types"
import { Check, UserPlus, X } from "lucide-react"

interface Props {
  invite: GroupInviteResponse
  onAccept?: (inviteId: string) => void
  onDecline?: (inviteId: string) => void
}

export default function GroupInviteItem({ invite, onAccept, onDecline }: Props) {
  const { t } = useTranslation()
  return (
    <div className="invite-item">
      <div className="invite-body">
        <UserPlus size={24} color="#2AABEE" strokeWidth={2} aria-hidden="true" />
        <div className="invite-text">
          <span className="invite-title">{t("chat.groupInviteTo", { name: invite.group.name })}</span>
          <span className="invite-from">{t("chat.fromUser", { username: invite.inviter.username })}</span>
        </div>
      </div>
      <div className="invite-actions">
        <button className="invite-btn accept" onClick={() => onAccept?.(invite.id)}>
          <Check size={16} strokeWidth={2} aria-hidden="true" />
           {t("chat.accept")}
        </button>
        <button className="invite-btn decline" onClick={() => onDecline?.(invite.id)}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
           {t("chat.decline")}
        </button>
      </div>
    </div>
  )
}
