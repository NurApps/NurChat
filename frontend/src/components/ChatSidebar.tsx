import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import ChatListItem from "./ChatListItem"
import ContactListItem from "./ContactListItem"
import GroupInviteItem from "./GroupInviteItem"
import { ChatListSkeleton } from "./Skeleton"
import FileManager from "./FileManager"
import { useFavoritesStore } from "../store/favoritesStore"
import type { UserResponse, ChatResponse, ContactResponse, GroupInviteResponse } from "../types"
import type { Tab } from "../store/chatStore"
import { Bookmark, ChevronLeft, ChevronRight, File, Globe, MessageCircle, Search, UserPlus, Users, Plus } from "lucide-react"

const SIDEBAR_WIDTH_KEY = "nurchat_sidebar_width"
const SIDEBAR_COLLAPSED_KEY = "nurchat_sidebar_collapsed"
const MIN_WIDTH = 260
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 320
const COLLAPSED_WIDTH = 60
const KEY_RESIZE_STEP = 16

function loadStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    const n = raw ? parseInt(raw, 10) : NaN
    if (Number.isFinite(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
  } catch { /* ignore */ }
  return DEFAULT_WIDTH
}

function persistWidth(w: number) {
  try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w)) } catch { /* ignore */ }
}

function loadStoredCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1" } catch { return false }
}

function persistCollapsed(collapsed: boolean) {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0") } catch { /* ignore */ }
}

interface Props {
  tab: Tab
  setTab: (tab: Tab) => void
  search: string
  setSearch: (s: string) => void
  filteredChats: ChatResponse[]
  filteredContacts: ContactResponse[]
  invites: GroupInviteResponse[]
  filteredInvites: GroupInviteResponse[]
  currentUser: UserResponse
  selectedChatId: string | null
  isMobile: boolean
  chatListRef: React.RefObject<HTMLDivElement | null>
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
  onOpenFavorites: () => void
  isFavoritesOpen: boolean
}

const TABS = [
  { key: "chats", icon: MessageCircle },
  { key: "contacts", icon: Users },
  { key: "files", icon: File },
  { key: "invites", icon: UserPlus },
] as const

export default function ChatSidebar({
  tab, setTab, search, setSearch, filteredChats, filteredContacts, invites, filteredInvites,
  currentUser, selectedChatId, isMobile, chatListRef,
  setShowCreateChat, setShowAddContact,
  handleSelectChat, handlePin, handleMute, handleDeleteChat,
  handleRemoveContact, handleStartChat, handleAcceptInvite, handleDeclineInvite,
  chatsLoaded, chatsError, onRetryChats, onGlobalSearch, onOpenFavorites, isFavoritesOpen,
}: Props) {
  const { t } = useTranslation()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const favoritesItems = useFavoritesStore((s) => s.items)
  const lastFavorite = favoritesItems[favoritesItems.length - 1]

  const [width, setWidth] = useState(loadStoredWidth)
  const [collapsed, setCollapsed] = useState(loadStoredCollapsed)
  // Сворачивание — только десктопная фича; на мобильной раскладке ширина и так 100%,
  // а сохранённое с прошлой десктопной сессии collapsed=true не должно её резать.
  const effectiveCollapsed = collapsed && !isMobile

  const toggleCollapsed = () => {
    setCollapsed((c) => { const next = !c; persistCollapsed(next); return next })
  }

  // Клик по вкладке в свёрнутой панели — разворачивает её и переключает вкладку:
  // свёрнутая полоса иконок работает как быстрый навигатор, а не тупик.
  const selectTab = (key: Tab) => {
    setTab(key)
    if (effectiveCollapsed) toggleCollapsed()
  }

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      setWidth((w) => { persistWidth(w); return w })
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [width])

  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null
    if (e.key === "ArrowLeft") next = Math.max(MIN_WIDTH, width - KEY_RESIZE_STEP)
    else if (e.key === "ArrowRight") next = Math.min(MAX_WIDTH, width + KEY_RESIZE_STEP)
    else if (e.key === "Home") next = MIN_WIDTH
    else if (e.key === "End") next = MAX_WIDTH
    if (next !== null) {
      e.preventDefault()
      setWidth(next)
      persistWidth(next)
    }
  }

  const resetWidth = () => {
    setWidth(DEFAULT_WIDTH)
    persistWidth(DEFAULT_WIDTH)
  }

  // Roving tabindex + стрелки для панели вкладок (WAI-ARIA tablist pattern).
  const handleTabsKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null
    if (e.key === "ArrowRight") nextIndex = (index + 1) % TABS.length
    else if (e.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (e.key === "Home") nextIndex = 0
    else if (e.key === "End") nextIndex = TABS.length - 1
    if (nextIndex !== null) {
      e.preventDefault()
      const nextKey = TABS[nextIndex].key
      selectTab(nextKey)
      tabRefs.current[nextKey]?.focus()
    }
  }

  return (
    <nav
      className={`chat-sidebar${effectiveCollapsed ? " collapsed" : ""}`}
      aria-label={t("chat.sidebar")}
      style={!isMobile ? {
        width: effectiveCollapsed ? COLLAPSED_WIDTH : width,
        minWidth: effectiveCollapsed ? COLLAPSED_WIDTH : MIN_WIDTH,
        maxWidth: effectiveCollapsed ? COLLAPSED_WIDTH : MAX_WIDTH,
      } : undefined}
    >
      <div className="sidebar-tabs-row">
        <div className="sidebar-tabs" role="tablist" aria-label={t("chat.sidebar")}>
          {TABS.map(({ key, icon: Icon }, index) => (
            <button key={key} ref={(el) => { tabRefs.current[key] = el }}
              id={`sidebar-tab-${key}`}
              className={`sidebar-tab ${tab === key ? "active" : ""}`}
              onClick={() => selectTab(key)}
              onKeyDown={(e) => handleTabsKeyDown(e, index)}
              title={t(`chat.${key}`)}
              role="tab" aria-selected={tab === key}
              aria-controls={`sidebar-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}>
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              {key === "invites" && invites.length > 0 && (
                <span className="tab-badge">{invites.length}</span>
              )}
            </button>
          ))}
        </div>
        {!isMobile && (
          <button className="sidebar-add-btn sidebar-collapse-btn"
            title={collapsed ? t("chat.expandSidebar") : t("chat.collapseSidebar")}
            aria-label={collapsed ? t("chat.expandSidebar") : t("chat.collapseSidebar")}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}>
            {collapsed ? <ChevronRight size={18} strokeWidth={2} aria-hidden="true" /> : <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />}
          </button>
        )}
      </div>

      {effectiveCollapsed ? null : (
      <>
      <div className="sidebar-search">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <input type="text" placeholder={t("common.search")} aria-label={t("common.search")}
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="sidebar-list-header">
        <span className="sidebar-list-title">
          {tab === "chats" ? t("chat.chats") : tab === "contacts" ? t("chat.contacts") : tab === "files" ? t("chat.files") : t("chat.invitations")}
        </span>
        <button className="sidebar-add-btn"
          title={t("common.globalSearch")}
          aria-label={t("common.globalSearch")}
          onClick={onGlobalSearch}>
          <Globe size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        {(tab === "chats" || tab === "contacts") && (
          <button className="sidebar-add-btn"
            title={tab === "chats" ? t("chat.newChat") : t("chat.newContact")}
            aria-label={tab === "chats" ? t("chat.newChat") : t("chat.newContact")}
            onClick={() => tab === "chats" ? setShowCreateChat(true) : setShowAddContact(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {tab === "chats" && (
          <div className="list-scroll" ref={chatListRef} role="tabpanel" id="sidebar-panel-chats" aria-labelledby="sidebar-tab-chats">
            {!chatsLoaded && <ChatListSkeleton />}
            {chatsLoaded && chatsError && filteredChats.length === 0 && (
              <div className="list-empty" role="alert">
                <p>{t("chat.chatsLoadFailed")}</p>
                <button className="settings-action-btn" onClick={onRetryChats}>
                  {t("common.retry")}
                </button>
              </div>
            )}
            {chatsLoaded && !chatsError && filteredChats.length === 0 && !search && (
              <p className="list-empty">{t("chat.noChats")}</p>
            )}
            {(!search || t("chat.bookmarks").toLowerCase().includes(search.toLowerCase())) && (
              <div
                className={`chat-list-item favorites-entry${isFavoritesOpen ? " active" : ""}`}
                onClick={onOpenFavorites} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") onOpenFavorites() }}
              >
                <div className="cli-avatar">
                  <div className="cli-avatar-circle favorites-avatar-circle">
                    <Bookmark size={18} strokeWidth={2} aria-hidden="true" />
                  </div>
                </div>
                <div className="cli-info">
                  <div className="cli-top-row">
                    <div className="cli-name-row">
                      <span className="cli-name">{t("chat.bookmarks")}</span>
                    </div>
                  </div>
                  <div className="cli-bottom-row">
                    <span className="cli-preview">{lastFavorite ? lastFavorite.content : t("bookmarks.empty")}</span>
                  </div>
                </div>
              </div>
            )}
            {filteredChats.map((chat) => (
              <ChatListItem key={chat.id} chat={chat} currentUser={currentUser}
                selected={chat.id === selectedChatId}
                onClick={handleSelectChat} onPin={handlePin}
                onMute={(id) => handleMute(id, !chat.is_muted)}
                onDelete={(id) => handleDeleteChat(id)} />
            ))}
          </div>
        )}
        {tab === "contacts" && (
          <div className="list-scroll" role="tabpanel" id="sidebar-panel-contacts" aria-labelledby="sidebar-tab-contacts">
            {filteredContacts.length === 0 && <p className="list-empty">{t("chat.noContacts")}</p>}
            {filteredContacts.map((contact) => (
              <ContactListItem key={contact.id} contact={contact}
                onRemove={handleRemoveContact} onStartChat={handleStartChat} />
            ))}
          </div>
        )}
        {tab === "invites" && (
          <div className="list-scroll" role="tabpanel" id="sidebar-panel-invites" aria-labelledby="sidebar-tab-invites">
            {filteredInvites.length === 0 && <p className="list-empty">{t("chat.noInvites")}</p>}
            {filteredInvites.map((invite) => (
              <GroupInviteItem key={invite.id} invite={invite}
                onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
            ))}
          </div>
        )}
        {tab === "files" && (
          <div className="list-scroll" role="tabpanel" id="sidebar-panel-files" aria-labelledby="sidebar-tab-files">
            <FileManager onClose={() => setTab("chats")} />
          </div>
        )}
      </div>
      </>
      )}

      {!isMobile && !effectiveCollapsed && (
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("chat.resizeSidebar")}
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={resetWidth}
        />
      )}
    </nav>
  )
}
