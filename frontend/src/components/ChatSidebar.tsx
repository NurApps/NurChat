import { useTranslation } from "react-i18next"
import ChatListItem from "./ChatListItem"
import ContactListItem from "./ContactListItem"
import GroupInviteItem from "./GroupInviteItem"
import { ChatListSkeleton } from "./Skeleton"
import FileManager from "./FileManager"
import type { UserResponse, ChatResponse, ContactResponse } from "../types"
import type { Tab } from "../store/chatStore"
import { File, MessageCircle, Search, UserPlus, Users, Plus } from "lucide-react"

interface Props {
  tab: Tab
  setTab: (tab: Tab) => void
  search: string
  setSearch: (s: string) => void
  chats: ChatResponse[]
  filteredChats: ChatResponse[]
  contacts: ContactResponse[]
  invites: any[]
  currentUser: UserResponse
  chatListRef: React.RefObject<HTMLDivElement | null>
  scrollToMessageId: string | null
  setScrollToMessageId: (id: string | null) => void
  setSelectedChat: (chat: ChatResponse | null) => void
  setShowCreateChat: (v: boolean) => void
  setShowAddContact: (v: boolean) => void
  handleSelectChat: (chatId: string) => void
  handlePin: (chatId: string, isPinned: boolean) => void
  handleMute: (id: string, muted: boolean) => void
  handleDeleteChat: (id: string) => void
  handleRemoveContact: (id: string) => void
  handleStartChat: (userId: string) => void
  handleAcceptInvite: (id: string) => void
  handleDeclineInvite: (id: string) => void
  chatsLoaded: boolean
  chatsError: string | null
  onRetryChats: () => void
  onGlobalSearch: () => void
}

const TABS = [
  { key: "chats", icon: MessageCircle },
  { key: "contacts", icon: Users },
  { key: "files", icon: File },
  { key: "invites", icon: UserPlus },
] as const

export default function ChatSidebar({
  tab, setTab, search, setSearch, chats, filteredChats, contacts, invites,
  currentUser, chatListRef, scrollToMessageId, setScrollToMessageId,
  setSelectedChat, setShowCreateChat, setShowAddContact,
  handleSelectChat, handlePin, handleMute, handleDeleteChat,
  handleRemoveContact, handleStartChat, handleAcceptInvite, handleDeclineInvite,
  chatsLoaded, chatsError, onRetryChats, onGlobalSearch,
}: Props) {
  const { t } = useTranslation()

  return (
    <nav className="chat-sidebar" aria-label={t("chat.sidebar")}>
      <div className="sidebar-tabs" role="tablist">
        {TABS.map(({ key, icon: Icon }) => (
          <button key={key} className={`sidebar-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)} title={t(`chat.${key}`)}
            role="tab" aria-selected={tab === key}>
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            {key === "invites" && invites.length > 0 && (
              <span className="tab-badge">{invites.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-search">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <input type="text" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="sidebar-list-header">
        <span className="sidebar-list-title">
          {tab === "chats" ? t("chat.chats") : tab === "contacts" ? t("chat.contacts") : tab === "files" ? t("chat.files") : t("chat.invitations")}
        </span>
        <button className="sidebar-add-btn"
          title={t("common.globalSearch")}
          aria-label={t("common.globalSearch")}
          onClick={onGlobalSearch}>
          <Search size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        {(tab === "chats" || tab === "contacts") && (
          <button className="sidebar-add-btn"
            title={tab === "chats" ? t("chat.newChat") : t("chat.newContact")}
            onClick={() => tab === "chats" ? setShowCreateChat(true) : setShowAddContact(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {tab === "chats" && (
          <div className="list-scroll" ref={chatListRef}>
            {!chatsLoaded && <ChatListSkeleton />}
            {chatsLoaded && chatsError && filteredChats.length === 0 && (
              <div className="list-empty" role="alert">
                <p>{t("chat.chatsLoadFailed")}</p>
                <button className="settings-action-btn" onClick={onRetryChats}>
                  {t("common.retry")}
                </button>
              </div>
            )}
            {chatsLoaded && !chatsError && filteredChats.length === 0 && (
              <p className="list-empty">{t("chat.noChats")}</p>
            )}
            {filteredChats.map((chat) => (
              <ChatListItem key={chat.id} chat={chat} currentUser={currentUser}
                onClick={handleSelectChat} onPin={handlePin}
                onMute={(id) => handleMute(id, !chat.is_muted)}
                onDelete={(id) => handleDeleteChat(id)} />
            ))}
          </div>
        )}
        {tab === "contacts" && (
          <div className="list-scroll">
            {contacts.length === 0 && <p className="list-empty">{t("chat.noContacts")}</p>}
            {contacts.map((contact) => (
              <ContactListItem key={contact.id} contact={contact}
                onRemove={handleRemoveContact} onStartChat={handleStartChat} />
            ))}
          </div>
        )}
        {tab === "invites" && (
          <div className="list-scroll">
            {invites.length === 0 && <p className="list-empty">{t("chat.noInvites")}</p>}
            {invites.map((invite) => (
              <GroupInviteItem key={invite.id} invite={invite}
                onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
            ))}
          </div>
        )}
        {tab === "files" && (
          <div className="list-scroll">
            <FileManager onClose={() => setTab("chats")} />
          </div>
        )}
      </div>
    </nav>
  )
}
