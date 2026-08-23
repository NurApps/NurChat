import { create } from "zustand"
import type {
  ChatResponse, MessageResponse, ContactResponse, GroupInviteResponse, UserResponse,
} from "../types"
import { api } from "../services/api"

interface Toast {
  id: string
  title: string
  body: string
  chatId?: string
}

interface IncomingCall {
  callId: string
  callerId: string
  callerName: string
  callType: string
}

type Tab = "chats" | "contacts" | "invites" | "bookmarks" | "files"

interface ChatState {
  currentUser: UserResponse
  tab: Tab
  chats: ChatResponse[]
  contacts: ContactResponse[]
  invites: GroupInviteResponse[]
  search: string
  selectedChat: ChatResponse | null
  messages: MessageResponse[]
  loadingMore: boolean
  hasMore: boolean
  onlineUsers: Record<string, boolean>
  typingUsers: Record<string, Record<string, boolean>>
  toast: Toast | null
  errorToast: string | null
  incomingCall: IncomingCall | null
  profileUser: UserResponse | null
  showGroupSettings: boolean
  showGlobalSearch: boolean
  showAddContact: boolean
  showCreateChat: boolean
  showMessageInfo: string | null
  bookmarkedIds: Set<string>

  input: string
  showEmoji: boolean
  showStickers: boolean
  uploading: boolean
  uploadProgress: number
  p2pConnected: Record<string, boolean>

  setTab: (tab: Tab) => void
  setChats: (chats: ChatResponse[]) => void
  setContacts: (contacts: ContactResponse[]) => void
  setInvites: (invites: GroupInviteResponse[]) => void
  setSearch: (search: string) => void
  setSelectedChat: (chat: ChatResponse | null) => void
  setMessages: (messages: MessageResponse[]) => void
  setHasMore: (hasMore: boolean) => void
  setOnlineUsers: (fn: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void
  setTypingUsers: (fn: Record<string, Record<string, boolean>> | ((prev: Record<string, Record<string, boolean>>) => Record<string, Record<string, boolean>>)) => void
  setToast: (toast: Toast | null) => void
  setErrorToast: (msg: string | null) => void
  setIncomingCall: (call: IncomingCall | null) => void
  setProfileUser: (user: UserResponse | null) => void
  setShowGroupSettings: (show: boolean) => void
  setShowGlobalSearch: (show: boolean) => void
  setShowAddContact: (show: boolean) => void
  setShowCreateChat: (show: boolean) => void
  setShowMessageInfo: (id: string | null) => void
  setBookmarkedIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  loadBookmarks: () => Promise<void>

  setInput: (input: string | ((prev: string) => string)) => void
  setShowEmoji: (show: boolean) => void
  setShowStickers: (show: boolean) => void
  setUploading: (uploading: boolean) => void
  setUploadProgress: (progress: number) => void
  setP2pConnected: (fn: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void

  loadChats: () => Promise<void>
  loadContacts: () => Promise<void>
  loadInvites: () => Promise<void>
  refreshCurrentUser: () => void
}

function getCurrentUser(): UserResponse {
  try {
    return JSON.parse(localStorage.getItem("user") || "null") || { id: "self", username: "user", first_name: "", is_online: true }
  } catch {
    return { id: "self", username: "user", first_name: "", is_online: true }
  }
}

export const useChatStore = create<ChatState>((set) => ({
  currentUser: getCurrentUser(),
  tab: "chats",
  chats: [],
  contacts: [],
  invites: [],
  search: "",
  selectedChat: null,
  messages: [],
  loadingMore: false,
  hasMore: true,
  onlineUsers: {},
  typingUsers: {},
  toast: null,
  errorToast: null,
  incomingCall: null,
  profileUser: null,
  showGroupSettings: false,
  showGlobalSearch: false,
  showAddContact: false,
  showCreateChat: false,
  showMessageInfo: null,
  bookmarkedIds: new Set(),

  input: "",
  showEmoji: false,
  showStickers: false,
  uploading: false,
  uploadProgress: 0,
  p2pConnected: {},

  setTab: (tab) => set({ tab }),
  setChats: (chats) => set({ chats }),
  setContacts: (contacts) => set({ contacts }),
  setInvites: (invites) => set({ invites }),
  setSearch: (search) => set({ search }),
  setSelectedChat: (chat) => set({ selectedChat: chat }),
  setMessages: (messages) => set({ messages }),
  setHasMore: (hasMore) => set({ hasMore }),
  setOnlineUsers: (fn) => set((state) => ({ onlineUsers: typeof fn === "function" ? fn(state.onlineUsers) : fn })),
  setTypingUsers: (fn) => set((state) => ({ typingUsers: typeof fn === "function" ? fn(state.typingUsers) : fn })),
  setToast: (toast) => set({ toast }),
  setErrorToast: (msg) => set({ errorToast: msg }),
  setIncomingCall: (call) => set({ incomingCall: call }),
  setProfileUser: (user) => set({ profileUser: user }),
  setShowGroupSettings: (show) => set({ showGroupSettings: show }),
  setShowGlobalSearch: (show) => set({ showGlobalSearch: show }),
  setShowAddContact: (show) => set({ showAddContact: show }),
  setShowCreateChat: (show) => set({ showCreateChat: show }),
  setShowMessageInfo: (id) => set({ showMessageInfo: id }),
  setBookmarkedIds: (ids) => set((state) => ({ bookmarkedIds: typeof ids === "function" ? ids(state.bookmarkedIds) : ids })),

  loadBookmarks: async () => {
    try {
      const bookmarks = await api.getBookmarks()
      const ids = new Set<string>(bookmarks.map((b) => b.message_id))
      useChatStore.getState().setBookmarkedIds(ids)
    } catch { /* ignore */ }
  },

  setInput: (input) => set((state) => ({ input: typeof input === "function" ? input(state.input) : input })),
  setShowEmoji: (show) => set({ showEmoji: show }),
  setShowStickers: (show) => set({ showStickers: show }),
  setUploading: (uploading) => set({ uploading }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  setP2pConnected: (fn) => set((state) => ({ p2pConnected: typeof fn === "function" ? fn(state.p2pConnected) : fn })),

  loadChats: async () => {
    try {
      const data = await api.getChats()
      set({ chats: data || [] })
    } catch {
      set({ chats: [] })
    }
  },

  loadContacts: async () => {
    try {
      const data = await api.getContacts()
      set({ contacts: data || [] })
    } catch {
      set({ contacts: [] })
    }
  },

  loadInvites: async () => {
    try {
      const data = await api.getGroupInvites()
      set({ invites: data || [] })
    } catch {
      set({ invites: [] })
    }
  },

  refreshCurrentUser: () => {
    set({ currentUser: getCurrentUser() })
  },
}))
