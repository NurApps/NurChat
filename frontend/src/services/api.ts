import { BASE_URL } from "../config"
import type { UserResponse, ChatResponse, MessageResponse, ContactResponse, GroupInviteResponse, FileUploadResponse, ReactionResponse, ContactRequestResponse } from "../types"

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

// Get CSRF token from cookie
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}


export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function csrfHeader(): string | null {
  return csrfTokenCache || getCsrfToken()
}

let csrfTokenCache: string | null = null;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken()
  const csrfToken = getCsrfToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new ApiError(res.status, text || res.statusText)

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

  getChats: (search?: string) =>
    request<ChatResponse[]>("GET", "/api/chat/chats" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  getChatMessages: (chatId: string, skip = 0, limit = 50) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/messages?skip=${skip}&limit=${limit}`),

  sendMessage: async (chatId: string, content: string, messageType = "text", fileId?: string, encryptedContent?: string, signature?: string, expiresAt?: string, replyToId?: string): Promise<MessageResponse> => {
    const body = {
      chat_id: chatId,
      content,
      message_type: messageType,
      file_id: fileId,
      encrypted_content: encryptedContent,
      signature,
      expires_at: expiresAt,
      reply_to_id: replyToId,
    }
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await request<MessageResponse>("POST", `/api/chat/chats/${chatId}/messages`, body)
      } catch (err: any) {
        lastError = err
        const msg = err?.message || ""
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

  deleteAccount: () =>
    request<{ message: string }>("DELETE", "/api/auth/account"),

  getContacts: () =>
    request<ContactResponse[]>("GET", "/api/contacts-groups/contacts"),

  addContact: (userId: string) =>
    request<ContactResponse>("POST", "/api/contacts-groups/contacts", { contact_user_id: userId }),

  removeContact: (contactId: string) =>
    request<void>("DELETE", `/api/contacts-groups/contacts/${contactId}`),

  getGroupInvites: () =>
    request<GroupInviteResponse[]>("GET", "/api/contacts-groups/groups/invites"),

  acceptGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/accept`),

  declineGroupInvite: (inviteId: string) =>
    request<void>("PUT", `/api/contacts-groups/groups/invites/${inviteId}/decline`),

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

  markAsRead: (chatId: string) =>
    request<{ message: string }>("POST", `/api/chat/chats/${chatId}/read`),

  getReadCount: (messageId: string) =>
    request<{ read_count: number; total_participants: number }>("GET", `/api/chat/messages/${messageId}/read-count`),

  searchMessages: (chatId: string, query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/search?q=${encodeURIComponent(query)}`),

  getBlockedUsers: () =>
    request<Array<{ id: number; user_id: string; blocked_user_id: string; created_at: string }>>("GET", "/api/chat/block"),

  unblockUser: (userId: string) =>
    request<{ message: string }>(`DELETE`, `/api/chat/block/${userId}`),

  exportChat: (chatId: string, format: string = "json") =>
    request<{ chat_name: string; export_date: string; messages: { id: string; sender: string; content: string; type: string; timestamp: string }[] }>(
      "GET", `/api/chat/chats/${chatId}/export?format=${format}`
    ),

  toggleReaction: (messageId: string, emoji: string) =>
    request<ReactionResponse[]>("POST", `/api/chat/messages/${messageId}/react`, { emoji }),

  globalSearch: (query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/search-global?q=${encodeURIComponent(query)}`),

  uploadFile: async (file: File, fileType: string, onProgress?: (percent: number) => void): Promise<FileUploadResponse> => {
    const token = getToken()
    const csrf = getCsrfToken()
    const form = new FormData()
    form.append("file", file)
    form.append("file_type", fileType)

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

  // P2P Sharing (direct server-to-server)
  discoverLAN: () =>
    request<{ peers: { node_id: string; host: string; port: number; user_id: string; username: string; peer_name: string; last_seen: string }[] }>("GET", "/api/discover/lan"),

  getP2PAddress: () =>
    request<{ uri: string; host: string; port: number; user_id: string; peer_id: string; port_open: boolean }>("GET", "/api/p2p/my-address"),

  openP2PPort: () =>
    request<{ message: string; uri: string; host: string; port: number; user_id: string }>("POST", "/api/p2p/open-port"),

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
        const ws = new WebSocket(`ws://${targetHost}:${targetPort}/ws/remote/${encodeURIComponent(token.slice(0, 16))}`)
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

  // IPFS
  getIPFSStatus: () =>
    request<{ enabled: boolean; online: boolean; api_url?: string; message: string }>("GET", "/api/ipfs/status"),

  getIPFSGatewayUrl: (hash: string) =>
    request<{ url: string | null; hash: string }>("GET", `/api/ipfs/gateway-url/${hash}`),

  pinIPFS: (hash: string) =>
    request<{ success: boolean; hash: string; message: string }>("POST", `/api/ipfs/pin/${hash}`),

  unpinIPFS: (hash: string) =>
    request<{ success: boolean; hash: string; message: string }>("DELETE", `/api/ipfs/pin/${hash}`),

  // IPFS Manager
  getIPFSManagerStatus: () =>
    request<{ installed: boolean; running: boolean; message: string; version?: string }>("GET", "/api/ipfs/manager/status"),

  installIPFS: () =>
    request<{ success: boolean; message: string }>("POST", "/api/ipfs/manager/install"),

  startIPFS: () =>
    request<{ success: boolean; message: string }>("POST", "/api/ipfs/manager/start"),

  stopIPFS: () =>
    request<{ success: boolean; message: string }>("POST", "/api/ipfs/manager/stop"),

  uninstallIPFS: () =>
    request<{ success: boolean; message: string }>("DELETE", "/api/ipfs/manager/uninstall"),

  // E2E Group Keys
  setGroupKey: (chatId: string, encryptedKeys: Record<string, string>) =>
    request<void>("POST", `/api/chat/chats/${chatId}/group-key`, { encrypted_keys: encryptedKeys }),


  setGroupKey: (chatId: string, encryptedKeys: Record<string, string>, creatorId?: string) =>
    request<void>("POST", `/api/chat/chats/${chatId}/group-key`, { encrypted_keys: encryptedKeys, creator_id: creatorId }),

  getGroupKey: (chatId: string) =>
    request<{ encrypted_key: string; chat_id: string; creator_id: string | null }>("GET", `/api/chat/chats/${chatId}/group-key`),

  getMyFiles: (fileType?: string) =>
    request<FileUploadResponse[]>("GET", "/api/files/my-files" + (fileType ? `?file_type=${fileType}` : "")),

  getVapidPublicKey: () =>
    request<{ public_key: string }>("GET", "/api/push/vapid-public-key"),

  subscribePush: (subscription: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ message: string }>("POST", "/api/push/subscribe", subscription),

  unsubscribePush: (endpoint: string) =>
    request<{ message: string }>("DELETE", `/api/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`),

  getIncomingContactRequests: () =>
    request<ContactRequestResponse[]>("GET", "/api/contacts/requests/incoming"),

  getSentContactRequests: () =>
    request<ContactRequestResponse[]>("GET", "/api/contacts/requests/sent"),

  acceptContactRequest: (requestId: string) =>
    request<ContactRequestResponse>("POST", `/api/contacts/requests/${requestId}/accept`),

  rejectContactRequest: (requestId: string) =>
    request<{ detail: string }>("POST", `/api/contacts/requests/${requestId}/reject`),

  uploadSignedPrekey: (publicKey: string, signature: string) =>
    request<{ status: string }>("POST", `/api/keys/signed-prekey?public_key=${encodeURIComponent(publicKey)}&signature=${encodeURIComponent(signature)}`),

  uploadOneTimePrekeys: (publicKeys: string[]) =>
    request<{ count: number }>("POST", "/api/keys/one-time", { public_keys: publicKeys }),

  getBundle: (userId: string) =>
    request<{ identity_key: string; signed_prekey: string; signed_prekey_signature: string; one_time_prekey: string | null; registration_id: number }>("GET", `/api/keys/bundle/${userId}`),

  getOneTimePrekeyCount: (userId: string) =>
    request<{ count: number }>("GET", `/api/keys/one-time-count/${userId}`),

  getIdentityKeys: (userId: string) =>
    request<{ user_id: string; identity_key: string; public_key: string }>("GET", `/api/auth/user/${userId}/identity-keys`),

  setToken: (token: string) => {
    localStorage.setItem("token", token)
  },

  isAuthenticated: () => {
    return !!getToken()
  },

  clearToken: () => {
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
}
