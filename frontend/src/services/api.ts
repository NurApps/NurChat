import { BASE_URL } from "../config"
import type { UserResponse, ChatResponse, MessageResponse, ContactResponse, GroupInviteResponse, FileUploadResponse, ReactionResponse, WebhookResponse, PollResponse, ContactRequestResponse } from "../types"

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

// Get CSRF token from cookie (works when frontend and API share a host).
export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Best-effort CSRF token for non-`request()` fetches (FormData uploads etc.).
// Prefers the header-captured cache (works cross-origin), falls back to cookie.
export function csrfHeader(): string | null {
  return csrfTokenCache || getCsrfToken()
}

// CSRF token captured from the X-CSRF-Token response header.
// The frontend and the API are usually on different origins (localhost:5173
// vs 127.0.0.1:8000, or tauri://localhost vs the relay), so document.cookie
// does not expose the token. We read it from the header instead.
let csrfTokenCache: string | null = null;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken()
  const csrfToken = csrfTokenCache || getCsrfToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const headerToken = res.headers.get("X-CSRF-Token")
    if (headerToken) csrfTokenCache = headerToken
    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(res.status, text || res.statusText)
    }
    if (res.status === 204) return undefined as T
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ access_token: string; refresh_token?: string; token_type: string; user: UserResponse; requires_2fa?: boolean }>("POST", "/api/auth/login", { username, password }),

  verify2faLogin: (code: string) =>
    request<{ access_token: string; token_type: string; user: UserResponse }>("POST", "/api/auth/2fa/verify-login", { code }),

  register: (username: string, password: string, first_name: string, last_name: string, captcha_id: string, captcha_code: string, public_key: string, signing_public_key: string) =>
    request<{ access_token: string; token_type: string; user: UserResponse }>("POST", "/api/auth/register", { username, password, first_name, last_name, captcha_id, captcha_code, public_key, signing_public_key }),

  getCaptcha: () =>
    request<{ captcha_id: string; question: string }>("GET", "/api/auth/captcha"),

  getCurrentUser: () =>
    request<UserResponse>("GET", "/api/auth/me"),

  getAllUsers: () =>
    request<UserResponse[]>("GET", "/api/auth/users"),

  getUser: (userId: string) =>
    request<UserResponse>("GET", `/api/auth/user/${userId}`),

  // Chats (server: /api/chat prefix)
  getChats: (search?: string) =>
    request<ChatResponse[]>("GET", "/api/chat/chats" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  getChatMessages: (chatId: string, skip = 0, limit = 50) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/messages?skip=${skip}&limit=${limit}`),

  sendMessage: async (chatId: string, content: string, messageType = "text", fileId?: string, encryptedContent?: string, signature?: string, expiresAt?: string, replyToId?: string, sealedSender?: boolean): Promise<MessageResponse> => {
    const body = {
      chat_id: chatId,
      content,
      message_type: messageType,
      file_id: fileId,
      encrypted_content: encryptedContent,
      signature,
      expires_at: expiresAt,
      reply_to_id: replyToId,
      sealed_sender: sealedSender,
    }
    // Retry with exponential backoff (up to 3 attempts)
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await request<MessageResponse>("POST", `/api/chat/chats/${chatId}/messages`, body)
      } catch (err: any) {
        lastError = err
        const msg = err?.message || ""
        // Don't retry on client errors (4xx) — only on network/5xx
        if (msg.includes("4") && !msg.includes("5")) throw err
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
        }
      }
    }
    throw lastError
  },

  deleteMessage: (messageId: string, deleteForAll = false) =>
    request<void>("DELETE", `/api/chat/messages/${messageId}?delete_for_all=${deleteForAll}`),

  editMessage: (messageId: string, content: string) =>
    request<MessageResponse>("PUT", `/api/chat/messages/${messageId}/edit?new_content=${encodeURIComponent(content)}`),

  getEditHistory: (messageId: string) =>
    request<{ message_id: string; current_content: string; edited_at: string | null; history: Array<{ content: string; edited_at: string }> }>("GET", `/api/chat/messages/${messageId}/edit-history`),

  rotateKey: (newPublicKey: string) =>
    request<{ status: string; old_key: string }>("POST", "/api/auth/profile/rotate-key", { new_public_key: newPublicKey }),

  deleteAccount: () =>
    request<{ message: string }>("DELETE", "/api/auth/account"),

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
  markAsRead: (chatId: string) =>
    request<{ message: string }>("POST", `/api/chat/chats/${chatId}/read`),

  getReadCount: (messageId: string) =>
    request<{ read_count: number; total_participants: number }>("GET", `/api/chat/messages/${messageId}/read-count`),

  // Search
  searchMessages: (chatId: string, query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/search?q=${encodeURIComponent(query)}`),

  // Blocked users
  getBlockedUsers: () =>
    request<Array<{ id: number; user_id: string; blocked_user_id: string; created_at: string }>>("GET", "/api/chat/block"),

  blockUser: (userId: string) =>
    request<{ message: string }>("POST", `/api/chat/block/${userId}`),

  unblockUser: (userId: string) =>
    request<{ message: string }>(`DELETE`, `/api/chat/block/${userId}`),

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
  uploadFile: async (file: File, fileType: string, onProgress?: (percent: number) => void): Promise<FileUploadResponse> => {
    const token = getToken()
    const csrf = getCsrfToken()
    const form = new FormData()
    form.append("file", file)
    form.append("file_type", fileType)

    // Use XMLHttpRequest for progress tracking
    if (onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("POST", `${BASE_URL}/api/files/upload`)
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
        if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(new ApiError(xhr.status, xhr.responseText || xhr.statusText))
          }
        }
        xhr.onerror = () => reject(new ApiError(0, "Network error"))
        xhr.send(form)
      })
    }

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

  // Calls
  getCallHistory: (skip = 0, limit = 50) =>
    request<{ calls: Array<{
      id: number
      call_id: string
      caller_id: string
      callee_id: string
      call_type: string
      started_at: string
      ended_at?: string
      duration?: number
      ended_by?: string
      caller?: { id: string; username: string; first_name: string }
      callee?: { id: string; username: string; first_name: string }
    }>; total: number }>("GET", `/api/calls/call-history?skip=${skip}&limit=${limit}`),

  getIceServers: () =>
    request<{ ice_servers: Array<{ urls: string; username?: string; credential?: string }> }>("GET", "/api/calls/ice-servers"),

  // Group Calls
  startGroupCall: (chatId: string, callType: string) =>
    request<{ call_id: string; chat_id: string; created_by: string; call_type: string; started_at: string; participants: unknown[]; participant_count: number }>("POST", "/api/group-calls/start", { chat_id: chatId, call_type: callType }),

  joinGroupCall: (callId: string) =>
    request<{ call_id: string; chat_id: string; created_by: string; call_type: string; started_at: string; participants: Array<{ user_id: string; username?: string; is_muted: boolean; is_video_off: boolean }>; participant_count: number }>("POST", `/api/group-calls/join/${callId}`),

  leaveGroupCall: (callId: string) =>
    request<{ status: string; remaining: number }>("POST", `/api/group-calls/leave/${callId}`),

  endGroupCall: (callId: string) =>
    request<{ status: string }>("POST", `/api/group-calls/end/${callId}`),

  getActiveGroupCall: (chatId: string) =>
    request<{ call_id: string; chat_id: string; created_by: string; call_type: string; participants: unknown[]; participant_count: number } | null>("GET", `/api/group-calls/active/${chatId}`),

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

  ackP2PPending: (ids: string[]) =>
    request<{ deleted: number }>("POST", "/api/p2p/pending/ack", { ids }),

  // P2P Sharing (direct server-to-server)
  discoverLAN: () =>
    request<{ peers: { node_id: string; host: string; port: number; user_id: string; username: string; peer_name: string; last_seen: string }[] }>("GET", "/api/discover/lan"),

  getP2PAddress: () =>
    request<{ uri: string; host: string; port: number; user_id: string; peer_id: string; port_open: boolean }>("GET", "/api/p2p/my-address"),

  openP2PPort: () =>
    request<{ message: string; uri: string; host: string; port: number; user_id: string }>("POST", "/api/p2p/open-port"),

  closeP2PPort: () =>
    request<{ message: string; host: string; port: number }>("POST", "/api/p2p/close-port"),

  getRemotePeers: () =>
    request<{ peers: { node_id: string; address: string; user_id: string; connected_at: string; is_relay: boolean }[] }>("GET", "/api/p2p/remote-peers"),

  getRelayPeers: () =>
    request<{ relays: { node_id: string; address: string; user_id: string }[] }>("GET", "/api/p2p/relay-peers"),

  registerRelay: () =>
    request<{ message: string; node_id: string }>("POST", "/api/p2p/register-relay"),

  connectToRemote: async (inviteUri: string, relayUri?: string) => {
    const [, rest] = inviteUri.split("://")
    if (!rest) throw new Error("Неверный формат ссылки")
    const [hostPort, userIdHash] = rest.split("/")
    const [host, portStr] = hostPort.split(":")
    const port = parseInt(portStr) || 8000
    const [userId] = (userIdHash || "").split("#")
    if (!host || !userId) throw new Error("Неверный формат ссылки")

    const token = getToken()
    if (!token) throw new Error("Не авторизован")

    const myUserId = JSON.parse(atob(token.split(".")[1])).sub || ""

    const tryConnect = (targetHost: string, targetPort: number, viaRelay: boolean): Promise<{ ws: WebSocket; node_id: string }> => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${targetHost}:${targetPort}/ws/remote/${encodeURIComponent(myUserId)}?token=${encodeURIComponent(token)}`)
        const timeout = setTimeout(() => { ws.close(); reject(new Error("Таймаут подключения")) }, 8000)
        ws.onopen = () => {
          clearTimeout(timeout)
          ws.send(JSON.stringify({
            type: "remote_hello",
            address: `${targetHost}:${targetPort}`,
            user_id: myUserId,
            is_relay: viaRelay,
            relay_for: viaRelay ? userId : "",
          }))
        }
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)
            if (data.type === "remote_ack") resolve({ ws, node_id: data.node_id })
          } catch { }
        }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error("Ошибка соединения")) }
      })
    }

    try {
      const result = await tryConnect(host, port, false)
      await request("POST", "/api/p2p/backups", { chat_id: userId, payload: JSON.stringify({ nodeId: result.node_id }) })
      return { connected: true, node_id: result.node_id }
    } catch {
      if (relayUri) {
        const [, relayRest] = relayUri.split("://")
        if (relayRest) {
          const [relayHost, relayPortStr] = relayRest.split("/")[0].split(":")
          const relayPort = parseInt(relayPortStr) || 8000
          const result = await tryConnect(relayHost, relayPort, true)
          return { connected: true, node_id: result.node_id, relayed: true }
        }
      }
      throw new Error("Не удалось подключиться (прямое соединение недоступно, укажите relay сервер)")
    }
  },

  // E2E Group Keys
  setGroupKey: (chatId: string, encryptedKeys: Record<string, string>, creatorId?: string) =>
    request<void>("POST", `/api/chat/chats/${chatId}/group-key`, { encrypted_keys: encryptedKeys, creator_id: creatorId }),

  getGroupKey: (chatId: string) =>
    request<{ encrypted_key: string; chat_id: string; creator_id: string | null }>("GET", `/api/chat/chats/${chatId}/group-key`),

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
    request<FileUploadResponse[]>("GET", "/api/files/my-files" + (fileType ? `?file_type=${fileType}` : "")),

  // Misc
  testConnection: () =>
    request<{ status: string }>("GET", "/health"),

  setToken: (token: string) => {
    localStorage.setItem("token", token)
  },

  clearToken: () => {
    // Best-effort server-side revocation before dropping local state
    const token = getToken()
    if (token) {
      fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {})
    }
    localStorage.removeItem("token")
    localStorage.removeItem("user")
  },

  isAuthenticated: () => {
    return !!getToken()
  },

  // Audit logs
  getAuditLogs: (skip = 0, limit = 100) =>
    request<{ logs: Array<{
      id: number
      action: string
      action_label: string
      details?: Record<string, unknown>
      ip_address?: string
      created_at?: string
    }>; actions: Record<string, string> }>("GET", `/api/audit/audit-logs?skip=${skip}&limit=${limit}`),

  // Webhooks
  getWebhooks: () =>
    request<WebhookResponse[]>("GET", "/api/webhooks"),

  createWebhook: (data: { name: string; url: string; events: string[]; secret?: string }) =>
    request<WebhookResponse>("POST", "/api/webhooks", data),

  updateWebhook: (id: string, data: { name?: string; url?: string; events?: string[]; secret?: string; is_active?: boolean }) =>
    request<WebhookResponse>("PUT", `/api/webhooks/${id}`, data),

  deleteWebhook: (id: string) =>
    request<void>("DELETE", `/api/webhooks/${id}`),

  testWebhook: (id: string) =>
    request<{ status: string; message: string }>("POST", `/api/webhooks/${id}/test`),

  // Pre-keys (E2E)
  uploadSignedPrekey: (publicKey: string, signature: string) =>
    request<{ status: string }>("POST", `/api/keys/signed-prekey?public_key=${encodeURIComponent(publicKey)}&signature=${encodeURIComponent(signature)}`),

  uploadOneTimePrekeys: (publicKeys: string[]) =>
    request<{ count: number }>("POST", "/api/keys/one-time", { public_keys: publicKeys }),

  getBundle: (userId: string) =>
    request<{ identity_key: string; signed_prekey: string; signed_prekey_signature: string; one_time_prekey: string | null; registration_id: number }>("GET", `/api/keys/bundle/${userId}`),

  getOneTimePrekeyCount: (userId: string) =>
    request<{ count: number }>("GET", `/api/keys/one-time-count/${userId}`),

  cleanupPrekeys: () =>
    request<{ deleted: number }>("POST", "/api/keys/cleanup"),

  getIdentityKeys: (userId: string) =>
    request<{ user_id: string; identity_key: string; public_key: string }>("GET", `/api/auth/user/${userId}/identity-keys`),

  // Polls
  createPoll: (chatId: string, data: { question: string; options: { text: string }[]; is_anonymous?: boolean; allow_multiple?: boolean; expires_at?: string }) =>
    request<PollResponse>("POST", `/api/chat/chats/${chatId}/polls`, { ...data, chat_id: chatId }),

  getPolls: (chatId: string) =>
    request<PollResponse[]>("GET", `/api/chat/chats/${chatId}/polls`),

  votePoll: (pollId: string, optionIds: number[]) =>
    request<PollResponse>("POST", `/api/chat/polls/${pollId}/vote`, { option_ids: optionIds }),

  // Contact Requests
  sendContactRequest: (toUserId: string, message?: string) =>
    request<ContactRequestResponse>("POST", "/api/contacts/requests", { to_user_id: toUserId, message }),

  getIncomingContactRequests: () =>
    request<ContactRequestResponse[]>("GET", "/api/contacts/requests/incoming"),

  getSentContactRequests: () =>
    request<ContactRequestResponse[]>("GET", "/api/contacts/requests/sent"),

  acceptContactRequest: (requestId: string) =>
    request<ContactRequestResponse>("POST", `/api/contacts/requests/${requestId}/accept`),

  rejectContactRequest: (requestId: string) =>
    request<{ detail: string }>("POST", `/api/contacts/requests/${requestId}/reject`),

  // View-once media
  markViewOnceViewed: (messageId: string) =>
    request<{ message_id: string; content: string | null; message_type: string; file_id: string | null; already_viewed: boolean }>(
      "POST", `/api/chat/messages/${messageId}/view-once`
    ),

  // Push notifications
  getVapidPublicKey: () =>
    request<{ public_key: string }>("GET", "/api/push/vapid-public-key"),

  subscribePush: (subscription: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ message: string }>("POST", "/api/push/subscribe", subscription),

  unsubscribePush: (endpoint: string) =>
    request<{ message: string }>("DELETE", `/api/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`),
}
