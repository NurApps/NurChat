import { useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Check, MoreHorizontal, Plus, UserPlus } from "lucide-react"
import { getAvatarColor } from "../utils/avatar"
import { loadAccounts, startAddAccount, switchToProfile } from "../services/accountActions"
import type { AccountProfile } from "../services/profiles"
import ConfirmModal from "./ConfirmModal"

interface Props {
  /** "menu" — компактный список в выпадающем меню; "settings" — строки настроек с действием «Убрать». */
  variant: "menu" | "settings"
  /** Аватар активного аккаунта (у остальных — цветная буква, как у чужих в чатах). */
  activeAvatarSrc?: string | null
  /** Убрать профиль с устройства; без него «⋯» не показывается. */
  onRemove?: (profile: AccountProfile) => Promise<void> | void
  /** Вызывается перед переходом/добавлением, например чтобы закрыть меню. */
  onAction?: () => void
}

/** Переключатель аккаунтов как в Telegram: аватар, имя, галочка у активного, «Добавить аккаунт». */
export default function AccountList({ variant, activeAvatarSrc, onRemove, onAction }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [{ profiles, activeId }, setState] = useState(loadAccounts)
  const [confirmAdd, setConfirmAdd] = useState(false)
  const [removing, setRemoving] = useState<AccountProfile | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Хост реле нужен только когда аккаунты живут на разных реле.
  const multiRelay = new Set(profiles.map((p) => `${p.relayProtocol}://${p.relayHost}`)).size > 1

  const handleSwitch = (p: AccountProfile) => {
    if (p.id === activeId) return
    onAction?.()
    switchToProfile(p)
  }

  const doAdd = () => {
    onAction?.()
    startAddAccount()
    navigate("/login", { replace: true })
  }

  const doRemove = async (p: AccountProfile) => {
    await onRemove?.(p)
    setState(loadAccounts())
    setOpenMenuId(null)
  }

  const modals = (
    <>
      {confirmAdd && createPortal(
        <ConfirmModal
          title={t("settings.accountAdd")}
          icon={<UserPlus size={18} strokeWidth={2} aria-hidden="true" />}
          message={t("settings.accountAddConfirm")}
          confirmLabel={t("settings.accountAddGo")}
          confirmTone="primary"
          onConfirm={doAdd}
          onClose={() => setConfirmAdd(false)}
        />,
        document.body,
      )}
      {removing && createPortal(
        <ConfirmModal
          title={t("settings.accountRemove")}
          message={t("settings.accountRemoveConfirm", { name: `${removing.username}@${removing.relayHost}` })}
          confirmLabel={t("settings.accountRemove")}
          onConfirm={() => void doRemove(removing)}
          onClose={() => setRemoving(null)}
        />,
        document.body,
      )}
    </>
  )

  return (
    <div className={`account-list account-list--${variant}`}>
      {profiles.map((p) => {
        const active = p.id === activeId
        return (
          <div key={p.id} className="account-list__row-wrap">
            <div className="account-list__row">
              <button
                type="button"
                className="account-list__main"
                aria-current={active ? "true" : undefined}
                onClick={() => handleSwitch(p)}
              >
                <span className="account-list__avatar" style={{ background: getAvatarColor(p.userId) }}>
                  {active && activeAvatarSrc
                    ? <img src={activeAvatarSrc} alt="" />
                    : <span aria-hidden="true">{(p.username[0] || "?").toUpperCase()}</span>}
                </span>
                <span className="account-list__text">
                  <span className="account-list__name">@{p.username}</span>
                  {multiRelay && <span className="account-list__relay">{p.relayProtocol}://{p.relayHost}</span>}
                </span>
                {active && <Check className="account-list__check" size={20} strokeWidth={2.5} aria-label={t("settings.accountActive")} />}
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="account-list__more"
                  aria-label={t("settings.accountOptions")}
                  aria-expanded={openMenuId === p.id}
                  onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                >
                  <MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
            {openMenuId === p.id && (
              <button type="button" className="account-list__remove" onClick={() => setRemoving(p)}>
                {t("settings.accountRemove")}
              </button>
            )}
          </div>
        )
      })}
      <button type="button" className="account-list__add" onClick={() => setConfirmAdd(true)}>
        <span className="account-list__add-icon"><Plus size={20} strokeWidth={2} aria-hidden="true" /></span>
        <span>{t("settings.accountAdd")}</span>
      </button>
      {modals}
    </div>
  )
}
