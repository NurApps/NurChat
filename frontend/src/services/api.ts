import { BASE_URL } from "../config"
import type { UserResponse, ChatResponse, MessageResponse, ContactResponse, GroupInviteResponse, FileUploadResponse, ReactionResponse } from "../types"

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem("token")
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new ApiError(res.status, text || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ access_token: string; token_type: string; user: UserResponse }>("POST", "/api/auth/login", { username, password }),

  register: (username: string, password: string, first_name?: string, last_name?: string) =>
    request<{ access_token: string; token_type: string; user: UserResponse; private_key?: string; signing_private_key?: string }>("POST", "/api/auth/register", { username, password, first_name, last_name }),

  getCurrentUser: () =>
    request<UserResponse>("GET", "/api/auth/me"),

  getAllUsers: () =>
    request<UserResponse[]>("GET", "/api/auth/users"),

  // Chats (server: /api/chat prefix)
  getChats: (search?: string) =>
    request<ChatResponse[]>("GET", "/api/chat/chats" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  getChatMessages: (chatId: string, skip = 0, limit = 50) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/messages?skip=${skip}&limit=${limit}`),

  sendMessage: (chatId: string, content: string, messageType = "text", fileId?: string, encryptedContent?: string, signature?: string, expiresAt?: string) =>
    request<MessageResponse>("POST", `/api/chat/chats/${chatId}/messages`, {
      chat_id: chatId,
      content,
      message_type: messageType,
      file_id: fileId,
      encrypted_content: encryptedContent,
      signature,
      expires_at: expiresAt,
    }),

  deleteMessage: (messageId: string, deleteForAll = false) =>
    request<void>("DELETE", `/api/chat/messages/${messageId}?delete_for_all=${deleteForAll}`),

  editMessage: (messageId: string, content: string) =>
    request<MessageResponse>("PUT", `/api/chat/messages/${messageId}/edit?new_content=${encodeURIComponent(content)}`),

  // Contacts (server: /api/contacts-groups prefix)
  getContacts: () =>
    request<ContactResponse[]>("GET", "/api/contacts-groups/contacts"),

  addContact: (userId: string) =>
    request<ContactResponse>("POST", "/api/contacts-groups/contacts", { contact_user_id: userId }),

  removeContact: (contactId: string) =>
    request<void>("DELETE", `/api/contacts-groups/contacts/${contactId}`),

  // Groups (server: /api/contacts-groups prefix)
  getGroupInvites: () =>
    request<GroupInviteResponse[]>("GET", "/api/contacts-groups/groups/invites"),

  acceptGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/accept`),

  declineGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/decline`),

  // Group management
  renameGroup: (groupId: string, name: string) =>
    request<ChatResponse>("PUT", `/api/contacts-groups/groups/${groupId}/rename`, { name }),

  addGroupParticipant: (groupId: string, userId: string) =>
    request<void>("POST", `/api/contacts-groups/groups/${groupId}/participants/${userId}`),

  removeGroupParticipant: (groupId: string, userId: string) =>
    request<void>("DELETE", `/api/contacts-groups/groups/${groupId}/participants/${userId}`),

  leaveGroup: (groupId: string) =>
    request<void>("POST", `/api/contacts-groups/groups/${groupId}/leave`),

  setGroupAdmin: (groupId: string, userId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/${groupId}/admin/${userId}`),

  getGroupMembers: (groupId: string) =>
    request<{ id: string; username: string; first_name: string; avatar_path: string | null; is_admin: boolean; joined_at: string | null }[]>("GET", `/api/contacts-groups/groups/${groupId}/members`),

  createChat: (name: string, participantIds: string[], isGroup: boolean, isSecret = false, disappearsAfterSeconds = 0) =>
    request<ChatResponse>("POST", "/api/chat/chats", { name, participant_ids: participantIds, is_group: isGroup, is_secret: isSecret, disappears_after_seconds: disappearsAfterSeconds }),

  deleteChat: (chatId: string) =>
    request<void>("DELETE", `/api/chat/chats/${chatId}`),

  pinChat: (chatId: string, pin: boolean) =>
    request<void>("POST", `/api/chat/chats/${chatId}/pin?pin=${pin}`),

  muteChat: (chatId: string, mute: boolean) =>
    request<void>("POST", `/api/chat/chats/${chatId}/mute?mute=${mute}`),

  // Read receipts
  markAsRead: (messageId: string) =>
    request<{ message: string }>("POST", `/api/chat/messages/${messageId}/mark-as-read`),

  getReadCount: (messageId: string) =>
    request<{ read_count: number; total_participants: number }>("GET", `/api/chat/messages/${messageId}/read-count`),

  // Search
  searchMessages: (chatId: string, query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/search?q=${encodeURIComponent(query)}`),

  // Export
  exportChat: (chatId: string, format: string = "json") =>
    request<{ chat_name: string; export_date: string; messages: { id: string; sender: string; content: string; type: string; timestamp: string }[] }>(
      "GET", `/api/chat/chats/${chatId}/export?format=${format}`
    ),

  // Reactions
  toggleReaction: (messageId: string, emoji: string) =>
    request<ReactionResponse[]>("POST", `/api/chat/messages/${messageId}/react`, { emoji }),

  getReactions: (messageId: string) =>
    request<ReactionResponse[]>("GET", `/api/chat/messages/${messageId}/reactions`),

  // Forward
  forwardMessage: (messageId: string, targetChatIds: string[]) =>
    request<MessageResponse[]>("POST", "/api/forward/forward", { message_id: messageId, target_chat_ids: targetChatIds }),

  getForwardChats: () =>
    request<ChatResponse[]>("GET", "/api/forward/chats/available-for-forward"),

  // Files
  uploadFile: async (file: File, fileType: string): Promise<FileUploadResponse> => {
    const token = getToken()
    const form = new FormData()
    form.append("file", file)
    form.append("file_type", fileType)
    const res = await fetch(`${BASE_URL}/api/files/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(res.status, text || res.statusText)
    }
    return res.json()
  },

  getFileUrl: (fileId: string) => {
    const token = getToken()
    return `${BASE_URL}/api/files/download/${fileId}?token=${encodeURIComponent(token || "")}`
  },

  downloadFile: async (fileId: string, filename: string) => {
    const token = getToken()
    const res = await fetch(`${BASE_URL}/api/files/download/${fileId}?token=${encodeURIComponent(token || "")}`)
    if (!res.ok) throw new ApiError(res.status, "Ошибка скачивания")
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename || "file"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  getStorageInfo: () =>
    request<{ total: number; files: number }>("GET", "/api/files/storage-info"),

  // P2P
  generateP2PKeys: () =>
    request<{ private_key: string; public_key: string; signing_private_key: string; signing_public_key: string }>("POST", "/api/p2p/keys/generate"),

  getP2PIdentity: () =>
    request<{ user_id: string; peer_id: string; public_key: string; signing_public_key: string; updated_at: string }>("GET", "/api/p2p/identity"),

  updateP2PIdentity: (publicKey: string, signingPublicKey: string) =>
    request<void>("POST", "/api/p2p/identity", { public_key: publicKey, signing_public_key: signingPublicKey }),

  searchP2PPeers: (query: string, limit = 50) =>
    request<{ user_id: string; peer_id: string; username: string; first_name: string; public_key?: string; is_online?: boolean }[]>("GET", `/api/p2p/peers/search?query=${encodeURIComponent(query)}&limit=${limit}`),

  getP2PPending: (limit = 500) =>
    request<{ id: string; sender_id: string; recipient_id: string; payload: string; created_at: string }[]>("GET", `/api/p2p/pending?limit=${limit}`),

  // IPFS
  getIPFSStatus: () =>
    request<{ enabled: boolean; online: boolean; api_url?: string; message: string }>("GET", "/api/ipfs/status"),

  getIPFSGatewayUrl: (hash: string) =>
    request<{ url: string | null; hash: string }>("GET", `/api/ipfs/gateway-url/${hash}`),

  pinIPFS: (hash: string) =>
    request<{ success: boolean; hash: string; message: string }>("POST", `/api/ipfs/pin/${hash}`),

  unpinIPFS: (hash: string) =>
    request<{ success: boolean; hash: string; message: string }>("DELETE", `/api/ipfs/pin/${hash}`),

  // E2E Group Keys
  setGroupKey: (chatId: string, encryptedKeys: Record<string, string>) =>
    request<void>("POST", `/api/chat/chats/${chatId}/group-key`, { encrypted_keys: encryptedKeys }),

  getGroupKey: (chatId: string) =>
    request<{ encrypted_key: string; chat_id: string }>("GET", `/api/chat/chats/${chatId}/group-key`),

  // Bookmarks
  getBookmarks: (chatId?: string) =>
    request<{ id: string; message_id: string; user_id: string; chat_id: string; created_at: string; message: MessageResponse }[]>(
      "GET", "/api/bookmarks" + (chatId ? `?chat_id=${chatId}` : "")
    ),

  addBookmark: (messageId: string, chatId: string) =>
    request<{ id: string; message_id: string; user_id: string; chat_id: string; created_at: string }>(
      "POST", "/api/bookmarks", { message_id: messageId, chat_id: chatId }
    ),

  removeBookmark: (messageId: string) =>
    request<void>("DELETE", `/api/bookmarks/${messageId}`),

  // Pinned Messages
  getPinnedMessages: (chatId: string) =>
    request<{ id: number; message_id: string; pinned_by: string; created_at: string; message: MessageResponse }[]>(
      "GET", `/api/chat/chats/${chatId}/pinned`
    ),

  pinMessage: (chatId: string, messageId: string) =>
    request<void>("POST", `/api/chat/chats/${chatId}/pin-message`, { message_id: messageId }),

  unpinMessage: (chatId: string, messageId: string) =>
    request<void>("DELETE", `/api/chat/chats/${chatId}/pin-message?message_id=${messageId}`),

  // Global Search
  globalSearch: (query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/search-global?q=${encodeURIComponent(query)}`),

  // Mark as Read
  markChatRead: (chatId: string) =>
    request<void>("POST", `/api/chat/chats/${chatId}/read`),

  // Stats
  getStats: () =>
    request<{
      total_messages: number
      total_chats: number
      total_files: number
      messages_by_day: { date: string; count: number }[]
      top_contacts: { user_id: string; username: string; first_name: string; message_count: number }[]
      message_types: Record<string, number>
    }>("GET", "/api/stats"),

  // Ephemeral messages
  sendEphemeralMessage: (chatId: string, content: string, expiresInSeconds: number, messageType = "text", fileId?: string) =>
    request<MessageResponse>("POST", `/api/chat/chats/${chatId}/messages-ephemeral?content=${encodeURIComponent(content)}&expires_in_seconds=${expiresInSeconds}&message_type=${messageType}${fileId ? `&file_id=${fileId}` : ""}`),

  // Files list
  getMyFiles: (fileType?: string) =>
    request<FileUploadResponse[]>("GET", "/api/files/my" + (fileType ? `?file_type=${fileType}` : "")),

  // Misc
  testConnection: () =>
    request<{ status: string }>("GET", "/api/health"),

  setToken: (token: string) => {
    localStorage.setItem("token", token)
  },

  clearToken: () => {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
  },

  isAuthenticated: () => {
    return !!getToken()
  },
}
