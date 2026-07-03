import { BASE_URL } from "../config"

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
    request<{ access_token: string; token_type: string; user: any }>("POST", "/api/auth/login", { username, password }),

  register: (username: string, password: string, first_name?: string, last_name?: string) =>
    request<{ access_token: string; token_type: string; user: any; private_key?: string; signing_private_key?: string }>("POST", "/api/auth/register", { username, password, first_name, last_name }),

  getCurrentUser: () =>
    request<any>("GET", "/api/auth/me"),

  getAllUsers: () =>
    request<any[]>("GET", "/api/auth/users"),

  // Chats (server: /api/chat prefix)
  getChats: (search?: string) =>
    request<any[]>("GET", "/api/chat/chats" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  getChatMessages: (chatId: string, skip = 0, limit = 50) =>
    request<any[]>("GET", `/api/chat/chats/${chatId}/messages?skip=${skip}&limit=${limit}`),

  sendMessage: (chatId: string, content: string, messageType = "text", fileId?: string, encryptedContent?: string, signature?: string) =>
    request<any>("POST", `/api/chat/chats/${chatId}/messages`, {
      chat_id: chatId,
      content,
      message_type: messageType,
      file_id: fileId,
      encrypted_content: encryptedContent,
      signature,
    }),

  deleteMessage: (messageId: string, deleteForAll = false) =>
    request<void>("DELETE", `/api/chat/messages/${messageId}?delete_for_all=${deleteForAll}`),

  editMessage: (messageId: string, content: string) =>
    request<any>("PUT", `/api/chat/messages/${messageId}/edit?new_content=${encodeURIComponent(content)}`),

  // Contacts (server: /api/contacts-groups prefix)
  getContacts: () =>
    request<any[]>("GET", "/api/contacts-groups/contacts"),

  addContact: (userId: string) =>
    request<any>("POST", "/api/contacts-groups/contacts", { contact_user_id: userId }),

  removeContact: (contactId: string) =>
    request<void>("DELETE", `/api/contacts-groups/contacts/${contactId}`),

  // Groups (server: /api/contacts-groups prefix)
  getGroupInvites: () =>
    request<any[]>("GET", "/api/contacts-groups/groups/invites"),

  acceptGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/accept`),

  declineGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/decline`),

  createChat: (name: string, participantIds: string[], isGroup: boolean) =>
    request<any>("POST", "/api/chat/chats", { name, participant_ids: participantIds, is_group: isGroup }),

  deleteChat: (chatId: string) =>
    request<void>("DELETE", `/api/chat/chats/${chatId}`),

  pinChat: (chatId: string, pin: boolean) =>
    request<void>("POST", `/api/chat/chats/${chatId}/pin?pin=${pin}`),

  muteChat: (chatId: string, mute: boolean) =>
    request<void>("POST", `/api/chat/chats/${chatId}/mute?mute=${mute}`),

  // Search
  searchMessages: (chatId: string, query: string) =>
    request<any[]>("GET", `/api/chat/chats/${chatId}/search?q=${encodeURIComponent(query)}`),

  // Reactions
  toggleReaction: (messageId: string, emoji: string) =>
    request<any[]>("POST", `/api/chat/messages/${messageId}/react`, { emoji }),

  getReactions: (messageId: string) =>
    request<any[]>("GET", `/api/chat/messages/${messageId}/reactions`),

  // Forward
  forwardMessage: (messageId: string, targetChatIds: string[]) =>
    request<any[]>("POST", "/api/forward/forward", { message_id: messageId, target_chat_ids: targetChatIds }),

  getForwardChats: () =>
    request<any[]>("GET", "/api/forward/chats/available-for-forward"),

  // Files
  uploadFile: async (file: File, fileType: string): Promise<any> => {
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

  // P2P
  generateP2PKeys: () =>
    request<{ private_key: string; public_key: string; signing_private_key: string; signing_public_key: string }>("POST", "/api/p2p/keys/generate"),

  getP2PIdentity: () =>
    request<{ user_id: string; peer_id: string; public_key: string; signing_public_key: string; updated_at: string }>("GET", "/api/p2p/identity"),

  updateP2PIdentity: (publicKey: string, signingPublicKey: string) =>
    request<any>("POST", "/api/p2p/identity", { public_key: publicKey, signing_public_key: signingPublicKey }),

  searchP2PPeers: (query: string, limit = 50) =>
    request<any[]>("GET", `/api/p2p/peers/search?query=${encodeURIComponent(query)}&limit=${limit}`),

  getP2PPending: (limit = 500) =>
    request<any[]>("GET", `/api/p2p/pending?limit=${limit}`),

  // E2E Group Keys
  setGroupKey: (chatId: string, encryptedKeys: Record<string, string>) =>
    request<any>("POST", `/api/chat/chats/${chatId}/group-key`, { encrypted_keys: encryptedKeys }),

  getGroupKey: (chatId: string) =>
    request<{ encrypted_key: string; chat_id: string }>("GET", `/api/chat/chats/${chatId}/group-key`),

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
