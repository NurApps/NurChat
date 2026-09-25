import { create } from "zustand"
import type {
  ChatResponse, ContactResponse, GroupInviteResponse, UserResponse,
} from "../types"
import { api } from "../services/api"

// Дедup параллельных loadChats (см. комментарий внутри loadChats).
let loadChatsInflight: Promise<void> | null = null

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

export type Tab = "chats" | "contacts" | "invites" | "files" | "calls" | "settings"

interface ChatState {
  currentUser: UserResponse
  tab: Tab
  chats: ChatResponse[]
  contacts: ContactResponse[]
  invites: GroupInviteResponse[]
  search: string
  selectedChat: ChatResponse | null
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

  input: string
  showEmoji: boolean
  uploading: boolean
  uploadProgress: number

  setTab: (tab: Tab) => void
  setSearch: (search: string) => void
  setSelectedChat: (chat: ChatResponse | null) => void
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

  setInput: (input: string | ((prev: string) => string)) => void
  setShowEmoji: (show: boolean) => void
  setUploading: (uploading: boolean) => void
  setUploadProgress: (progress: number) => void

  loadChats: () => Promise<void>
  loadContacts: () => Promise<void>
  loadInvites: () => Promise<void>
  refreshCurrentUser: () => void
  /** Первая загрузка завершена (успех или итоговая ошибка) — до этого скелетон. */
  chatsLoaded: boolean
  /** Текст ошибки последней загрузки (null = ок). */
  chatsError: string | null
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

  input: "",
  showEmoji: false,
  uploading: false,
  uploadProgress: 0,

  setTab: (tab) => set({ tab }),
  setSearch: (search) => set({ search }),
  setSelectedChat: (chat) => set({ selectedChat: chat }),
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

  setInput: (input) => set((state) => ({ input: typeof input === "function" ? input(state.input) : input })),
  setShowEmoji: (show) => set({ showEmoji: show }),
  setUploading: (uploading) => set({ uploading }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),

  chatsLoaded: false,
  chatsError: null,

  loadChats: async () => {
    // Single-flight: ChatPage-mount и каждый WS-(re)connect зовут loadChats,
    // а внутри до 3 попыток. Без дедупа через рваный туннель летит шторм
    // параллельных fetch, каждый обрывается клиентом — в логах cloudflared
    // это «context canceled», а в консоли десятки Failed to fetch.
    // Параллельные вызовы делят один in-flight промис вместо нового шторма.
    if (loadChatsInflight) return loadChatsInflight
    loadChatsInflight = (async () => {
      // Ретраи с бэкоффом: через туннель первый запрос часто падает
      // (холодный старт релея/QUIC), а молчаливый провал = вечный скелетон.
      set({ chatsError: null })
      let lastErr: unknown = null
      for (const waitMs of [0, 1000, 3000]) {
        if (waitMs) await new Promise((r) => setTimeout(r, waitMs))
        try {
          const data = await api.getChats()
          set({ chats: data || [], chatsLoaded: true, chatsError: null })
          return
        } catch (err) {
          lastErr = err
          console.error("[chatStore] loadChats failed:", err)
        }
      }
      const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
      set({ chatsLoaded: true, chatsError: detail || "load failed" })
    })()
    try {
      await loadChatsInflight
    } finally {
      loadChatsInflight = null
    }
  },

  loadContacts: async () => {
    try {
      const data = await api.getContacts()
      set({ contacts: data || [] })
    } catch (err) {
      console.error("[chatStore] loadContacts failed:", err)
    }
  },

  loadInvites: async () => {
    try {
      const data = await api.getGroupInvites()
      set({ invites: data || [] })
    } catch (err) {
      console.error("[chatStore] loadInvites failed:", err)
    }
  },

  refreshCurrentUser: () => {
    set({ currentUser: getCurrentUser() })
  },
}))
