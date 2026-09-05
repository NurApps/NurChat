import { create } from "zustand"
import type {
  ChatResponse, ContactResponse, GroupInviteResponse, UserResponse,
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

type Tab = "chats" | "contacts" | "invites" | "files"

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

  loadChats: async () => {
    try {
      const data = await api.getChats()
      set({ chats: data || [] })
    } catch (err) {
      console.error("[chatStore] loadChats failed:", err)
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
