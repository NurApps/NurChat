import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import ChatListItem from "./ChatListItem"
import ContactListItem from "./ContactListItem"
import GroupInviteItem from "./GroupInviteItem"
import { ChatListSkeleton } from "./Skeleton"
import { useFavoritesStore } from "../store/favoritesStore"
import { api } from "../services/api"
import { formatTime } from "../utils/format"
import type { UserResponse, ChatResponse, ContactResponse, GroupInviteResponse, MessageResponse } from "../types"
import type { Tab } from "../store/chatStore"
import { Bookmark, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Link2, MessageCircle, Search, UserPlus, Users, Plus } from "lucide-react"

type SearchCategory = "chats" | "media" | "files" | "links"

interface MessageSearchResult {
  chat: ChatResponse
  message: MessageResponse
}

const SEARCH_CATEGORIES: { key: SearchCategory; icon: typeof Search }[] = [
  { key: "chats", icon: Search },
  { key: "media", icon: ImageIcon },
  { key: "files", icon: FileText },
  { key: "links", icon: Link2 },
]

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/i

function matchesSearchCategory(message: MessageResponse, category: SearchCategory): boolean {
  if (category === "chats") return true
  if (category === "media") return message.message_type === "image" || message.message_type === "video"
  if (category === "files") return message.message_type === "file" || message.message_type === "audio" || message.message_type === "voice"
  if (category === "links") return message.message_type === "text" && URL_RE.test(message.content || "")
  return true
}

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
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  chats: ChatResponse[]
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
  onSelectSearchMessage: (chatId: string, messageId: string) => void
  onOpenFavorites: () => void
  isFavoritesOpen: boolean
}

const TABS = [
  { key: "chats", icon: MessageCircle },
  { key: "contacts", icon: Users },
] as const

export default function ChatSidebar({
  tab, setTab, search, setSearch, searchInputRef, chats, filteredChats, filteredContacts, invites, filteredInvites,
  currentUser, selectedChatId, isMobile, chatListRef,
  setShowCreateChat, setShowAddContact,
  handleSelectChat, handlePin, handleMute, handleDeleteChat,
  handleRemoveContact, handleStartChat, handleAcceptInvite, handleDeclineInvite,
  chatsLoaded, chatsError, onRetryChats, onSelectSearchMessage, onOpenFavorites, isFavoritesOpen,
}: Props) {
  const { t } = useTranslation()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const favoritesItems = useFavoritesStore((s) => s.items)
  const lastFavorite = favoritesItems[favoritesItems.length - 1]

  const [searchFocused, setSearchFocused] = useState(false)
  const searchAreaRef = useRef<HTMLDivElement>(null)
  const hasQuery = search.trim().length > 0
  // Как в Telegram: категории выезжают, как только поле в фокусе — ещё до
  // ввода текста, а не только когда что-то напечатано.
  const isSearching = tab === "chats" && (searchFocused || hasQuery)
  const [category, setCategory] = useState<SearchCategory>("chats")
  const [msgResults, setMsgResults] = useState<MessageSearchResult[]>([])
  const [msgSearching, setMsgSearching] = useState(false)

  // Единственная строка поиска в сайдбаре — ищет и по названиям чатов
  // (мгновенно, локально), и по содержимому сообщений (через relay, с
  // debounce), как в Telegram: один инпут, категории результатов под ним.
  // Сам запрос к relay идёт только когда что-то введено — фокус без текста
  // категории показывает, но ничего не ищет.
  useEffect(() => {
    if (!hasQuery) { setMsgResults([]); return }
    const q = search.trim()
    setMsgSearching(true)
    const timer = setTimeout(async () => {
      try {
        const messages = await api.globalSearch(q)
        const grouped: MessageSearchResult[] = []
        for (const msg of messages) {
          const chat = chats.find((c) => c.id === msg.chat_id)
          if (chat) grouped.push({ chat, message: msg })
        }
        setMsgResults(grouped)
      } catch {
        setMsgResults([])
      } finally {
        setMsgSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [hasQuery, search, chats])

  useEffect(() => {
    if (!isSearching) setCategory("chats")
  }, [isSearching])

  const categoryResults = useMemo(
    () => msgResults.filter((r) => matchesSearchCategory(r.message, category)),
    [msgResults, category]
  )

  // "Чаты"/"Контакты" дублируют нижнюю навигацию на мобильном (те же
  // маршруты, то же состояние tab — см. эффект по location.pathname в
  // ChatPage), поэтому верхний ряд вкладок на мобильном не рендерится
  // вовсе (см. ниже). "Файлы" и "Заявки" убраны из него полностью:
  // первое — теперь категория поиска, второе — закреплённая строка
  // над списком чатов (см. ниже).

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
      {!isMobile && (
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
      )}

      {effectiveCollapsed ? null : (
      <>
      <div
        ref={searchAreaRef}
        onBlur={(e) => {
          if (!searchAreaRef.current?.contains(e.relatedTarget as Node)) setSearchFocused(false)
        }}
      >
        <div className="sidebar-search">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input ref={searchInputRef} type="text" placeholder={t("common.search")} aria-label={t("common.search")}
            value={search} onFocus={() => setSearchFocused(true)} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {/* Категории результатов выезжают из-под поиска, как в Telegram —
            один инпут вместо отдельной модалки глобального поиска, и
            появляются уже по фокусу поля, не дожидаясь ввода текста. */}
        <div className={`gs-tabs-collapse${isSearching ? " open" : ""}`}>
          <div className="gs-tabs" role="tablist" aria-label={t("chat.searchAllChats")}>
            {SEARCH_CATEGORIES.map(({ key, icon: Icon }) => (
              <button key={key} role="tab" aria-selected={category === key}
                className={`gs-tab${category === key ? " active" : ""}`}
                onClick={() => setCategory(key)}>
                <Icon size={14} strokeWidth={2} aria-hidden="true" />
                {t(`chat.${key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-list-header">
        {tab === "invites" && (
          <button className="sidebar-add-btn" title={t("common.back", "Назад")} aria-label={t("common.back", "Назад")}
            onClick={() => setTab("chats")}>
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <span className="sidebar-list-title">
          {tab === "chats" ? t("chat.chats") : tab === "contacts" ? t("chat.contacts") : t("chat.invitations")}
        </span>
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
          <div className="list-scroll" ref={chatListRef} id="sidebar-panel-chats" aria-label={t("chat.chats")}>
            {(!isSearching || category === "chats") && (
              <>
                {!chatsLoaded && <ChatListSkeleton />}
                {chatsLoaded && (!search || t("chat.bookmarks").toLowerCase().includes(search.toLowerCase())) && (
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
                {chatsLoaded && invites.length > 0 && (!search || t("chat.invitations").toLowerCase().includes(search.toLowerCase())) && (
                  <div
                    className="chat-list-item invites-entry"
                    onClick={() => setTab("invites")} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") setTab("invites") }}
                  >
                    <div className="cli-avatar">
                      <div className="cli-avatar-circle invites-avatar-circle">
                        <UserPlus size={18} strokeWidth={2} aria-hidden="true" />
                      </div>
                    </div>
                    <div className="cli-info">
                      <div className="cli-top-row">
                        <div className="cli-name-row">
                          <span className="cli-name">{t("chat.invitations")}</span>
                        </div>
                      </div>
                      <div className="cli-bottom-row">
                        <span className="cli-preview">{t("chat.pendingInvites", { count: invites.length })}</span>
                        <span className="cli-badge">{invites.length >= 100 ? "99+" : invites.length}</span>
                      </div>
                    </div>
                  </div>
                )}
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
                {filteredChats.map((chat) => (
                  <ChatListItem key={chat.id} chat={chat} currentUser={currentUser}
                    selected={chat.id === selectedChatId}
                    onClick={handleSelectChat} onPin={handlePin}
                    onMute={(id) => handleMute(id, !chat.is_muted)}
                    onDelete={(id) => handleDeleteChat(id)} />
                ))}
              </>
            )}

            {isSearching && (
              <>
                {category === "chats" && categoryResults.length > 0 && (
                  <div className="gs-section-label">{t("chat.messages")}</div>
                )}
                {hasQuery && msgSearching && <p className="global-search-empty">{t("common.loading")}</p>}
                {hasQuery && !msgSearching && category !== "chats" && categoryResults.length === 0 && (
                  <p className="global-search-empty">{t("chat.nothingFound")}</p>
                )}
                {hasQuery && !msgSearching && category === "chats" && filteredChats.length === 0 && categoryResults.length === 0 && (
                  <p className="global-search-empty">{t("chat.nothingFound")}</p>
                )}
                {!msgSearching && categoryResults.map((r) => {
                  const time = formatTime(r.message.created_at)
                  const chatName = r.chat.is_group ? (r.chat.name || t("chat.group")) : (r.chat.participants.find(p => p.id !== r.message.user_id)?.username || t("chat.chat"))
                  const isFileLike = r.message.message_type !== "text"
                  const preview = isFileLike ? (r.message.file?.filename || t(`chat.${r.message.message_type}`)) : r.message.content.slice(0, 80)
                  return (
                    <div key={r.message.id} className="global-search-item" onClick={() => onSelectSearchMessage(r.chat.id, r.message.id)}>
                      <div className="gs-chat-name">{chatName}</div>
                      <div className="gs-message">
                        <span className="gs-sender">{r.message.user?.username || "User"}</span>
                        <span className="gs-text">{preview}</span>
                      </div>
                      <span className="gs-time">{time}</span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
        {tab === "contacts" && (
          <div className="list-scroll" id="sidebar-panel-contacts" aria-label={t("chat.contacts")}>
            {filteredContacts.length === 0 && <p className="list-empty">{t("chat.noContacts")}</p>}
            {filteredContacts.map((contact) => (
              <ContactListItem key={contact.id} contact={contact}
                onRemove={handleRemoveContact} onStartChat={handleStartChat} />
            ))}
          </div>
        )}
        {tab === "invites" && (
          <div className="list-scroll" aria-label={t("chat.invitations")}>
            {filteredInvites.length === 0 && <p className="list-empty">{t("chat.noInvites")}</p>}
            {filteredInvites.map((invite) => (
              <GroupInviteItem key={invite.id} invite={invite}
                onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
            ))}
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
