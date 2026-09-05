import { useTranslation } from "react-i18next"
import ChatListItem from "./ChatListItem"
import ContactListItem from "./ContactListItem"
import GroupInviteItem from "./GroupInviteItem"
import { ChatListSkeleton } from "./Skeleton"
import FileManager from "./FileManager"
import type { UserResponse, ChatResponse, ContactResponse } from "../types"

interface Props {
  tab: string
  setTab: (tab: string) => void
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
  handleSelectChat: (chat: ChatResponse) => void
  handlePin: (id: string, isPinned: boolean) => void
  handleMute: (id: string, muted: boolean) => void
  handleDeleteChat: (id: string) => void
  handleRemoveContact: (id: string) => void
  handleStartChat: (userId: string) => void
  handleAcceptInvite: (id: string) => void
  handleDeclineInvite: (id: string) => void
}

const TABS = [
  { key: "chats", icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  { key: "contacts", icon: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
  { key: "files", icon: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /> },
  { key: "invites", icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></> },
] as const

export default function ChatSidebar({
  tab, setTab, search, setSearch, chats, filteredChats, contacts, invites,
  currentUser, chatListRef, scrollToMessageId, setScrollToMessageId,
  setSelectedChat, setShowCreateChat, setShowAddContact,
  handleSelectChat, handlePin, handleMute, handleDeleteChat,
  handleRemoveContact, handleStartChat, handleAcceptInvite, handleDeclineInvite,
}: Props) {
  const { t } = useTranslation()

  return (
    <nav className="chat-sidebar" aria-label={t("chat.sidebar")}>
      <div className="sidebar-tabs" role="tablist">
        {TABS.map(({ key, icon }) => (
          <button key={key} className={`sidebar-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)} title={t(`chat.${key}`)}
            role="tab" aria-selected={tab === key}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{icon}</svg>
            {key === "invites" && invites.length > 0 && (
              <span className="tab-badge">{invites.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input type="text" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="sidebar-list-header">
        <span className="sidebar-list-title">
          {tab === "chats" ? t("chat.chats") : tab === "contacts" ? t("chat.contacts") : tab === "files" ? t("chat.files") : tab === "bookmarks" ? t("chat.bookmarks") : t("chat.invitations")}
        </span>
        {(tab === "chats" || tab === "contacts") && (
          <button className="sidebar-add-btn"
            title={tab === "chats" ? t("chat.newChat") : t("chat.newContact")}
            onClick={() => tab === "chats" ? setShowCreateChat(true) : setShowAddContact(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {tab === "chats" && (
          <div className="list-scroll" ref={chatListRef}>
            {filteredChats.length === 0 && !search && <ChatListSkeleton />}
            {filteredChats.length === 0 && search && <p className="list-empty">{t("chat.noChats")}</p>}
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
