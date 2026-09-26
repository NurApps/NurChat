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

/**
 * Человекочитаемое сообщение из ошибки API: сервер отдаёт JSON {"detail": ...},
 * ApiError несёт его сырым текстом. Возвращает detail либо fallback.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : ""
  if (!raw) return fallback
  try {
    const detail = JSON.parse(raw)?.detail
    if (typeof detail === "string" && detail) return detail
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg
  } catch { /* не JSON — сетевые ошибки и т.п. */ }
  return raw.startsWith("{") || raw.startsWith("<") ? fallback : raw
}

function getToken(): string | null {
  return localStorage.getItem("token")
}

export function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function csrfHeader(): string | null {
  return csrfTokenCache || getCsrfToken()
}

let csrfTokenCache: string | null = null;

// Fired when the session is unrecoverably dead (refresh rejected/expired).
// App listens and navigates to /login; AuthGuard covers the rest on mount.
export const AUTH_EXPIRED_EVENT = "nurchat:auth-expired"
function notifyAuthExpired(): void {
  try {
    localStorage.removeItem("token")
    localStorage.removeItem("refresh_token")
    localStorage.removeItem("user")
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  } catch { /* ignore */ }
}

// Single-flight refresh: concurrent 401s share one POST /refresh
// (the endpoint is rate-limited 10/min AND rotates the refresh token,
// so parallel refreshes would revoke each other).
let refreshPromise: Promise<boolean> | null = null
export function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const rt = localStorage.getItem("refresh_token")
      if (!rt) return false
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30000)
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token_str: rt }),
          signal: controller.signal,
        })
        if (!res.ok) return false
        const data = await res.json()
        if (!data.access_token) return false
        localStorage.setItem("token", data.access_token)
        if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token)
        return true
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

// Auth endpoints must never trigger auto-refresh (a 401 there means
// wrong credentials / bad captcha, not an expired session).
function isAuthPath(path: string): boolean {
  return path.startsWith("/api/auth/login")
    || path.startsWith("/api/auth/register")
    || path.startsWith("/api/auth/refresh")
    || path.startsWith("/api/auth/captcha")
    || path.startsWith("/api/auth/2fa")
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const token = getToken()
  const csrfToken = csrfTokenCache || getCsrfToken()
  const controller = new AbortController()
  // 30с: через cloudflare-туннель (QUIC, холодный старт, возможный
  // антивирус-прокси типа fetchCallImpl у тестера) ответы регулярно идут
  // дольше 15с. Ранний аборт = «context canceled» в логах cloudflared и
  // каскад ретраев, который только хуже забивает туннель.
  const timeout = setTimeout(() => controller.abort(), 30000)
  // Диагностика туннеля: замер каждого запроса. В консоли тестера видно,
  // умер запрос на таймауте (30с, AbortError) или упал сразу (сеть/CORS),
  // и сколько реально отвечал релей — без этого чинить вслепую.
  const startedAt = performance.now()
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
    const elapsed = Math.round(performance.now() - startedAt)
    if (elapsed > 3000) {
      // Константная формат-строка первым аргументом: method/path — данные
      // (путь запроса), их интерполяция в шаблон триггерит CodeQL
      // «format string depends on user-provided value». Передаём отдельно.
      console.warn("[api] slow request:", method, path, `${elapsed}ms`, `status ${res.status}`)
    }
    const headerToken = res.headers.get("X-CSRF-Token")
    if (headerToken) csrfTokenCache = headerToken
    if (!res.ok) {
      // Access TTL is 30 min and the server rechecks JWTs on live sockets:
      // a 401 here usually means expiry, not logout — refresh once and retry.
      if (res.status === 401 && !retried && !isAuthPath(path)) {
        const ok = await refreshAccessToken()
        if (ok) return request<T>(method, path, body, true)
        notifyAuthExpired()
      }
      const text = await res.text()
      throw new ApiError(res.status, text || res.statusText)
    }
    if (res.status === 204) return undefined as T
    return res.json()
  } catch (err) {
    // Имя + время: AbortError на ~30с = релей не ответил (сеть/туннель/БД),
    // мгновенный TypeError = обрыв/CORS. Текст ошибки НЕ меняем (на него
    // завязаны проверки вызывателей), только дописываем в консоль.
    const elapsed = Math.round(performance.now() - startedAt)
    const kind = err instanceof DOMException && err.name === "AbortError" ? "timeout-abort" : "network-error"
    console.error("[api] request failed:", kind, method, path, `after ${elapsed}ms`, err)
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export const api = {
  login: (username: string, password: string) =>
    request<{ access_token: string; refresh_token?: string; token_type: string; user: UserResponse; requires_2fa?: boolean }>("POST", "/api/auth/login", { username, password }),

  verify2faLogin: (code: string) =>
    request<{ access_token: string; refresh_token?: string; token_type: string; user: UserResponse }>("POST", "/api/auth/2fa/verify-login", { code }),

  register: (username: string, password: string, first_name: string, last_name: string, captcha_id: string, captcha_code: string, public_key: string, signing_public_key: string) =>
    request<{ access_token: string; refresh_token?: string; token_type: string; user: UserResponse }>("POST", "/api/auth/register", { username, password, first_name, last_name, captcha_id, captcha_code, public_key, signing_public_key }),

  getCaptcha: () =>
    request<{ captcha_id: string; question: string }>("GET", "/api/auth/captcha"),

  getCurrentUser: () =>
    request<UserResponse>("GET", "/api/auth/me"),

  updateProfile: async (fields: { first_name: string; last_name: string; status: string; bio: string }): Promise<UserResponse> => {
    // Пустые status/bio отправляем как есть: сервер трактует "" как очистку,
    // а отсутствие поля как «не менять».
    const send = () => {
      const form = new FormData()
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      const token = getToken()
      const csrf = csrfHeader()
      return fetch(`${BASE_URL}/api/auth/profile/update`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: form,
      })
    }
    let res = await send()
    if (res.status === 401 && await refreshAccessToken()) res = await send()
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
    const updated: UserResponse = await res.json()
    localStorage.setItem("user", JSON.stringify(updated))
    return updated
  },

  logoutAll: () =>
    request<{ message: string }>("POST", "/api/auth/logout-all"),

  getAllUsers: () =>
    request<UserResponse[]>("GET", "/api/auth/users"),

  getUser: (userId: string) =>
    request<UserResponse>("GET", `/api/auth/user/${userId}`),

  getChats: (search?: string) =>
    request<ChatResponse[]>("GET", "/api/chat/chats" + (search ? `?search=${encodeURIComponent(search)}` : "")),

  getChatMessages: (chatId: string, skip = 0, limit = 50, since?: string) =>
    request<MessageResponse[]>("GET", `/api/chat/chats/${chatId}/messages?skip=${skip}&limit=${limit}` + (since ? `&since=${encodeURIComponent(since)}` : "")),

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

  editMessage: (messageId: string, body: { content: string; encrypted_content?: string; signature?: string }) =>
    request<{ message: string }>("PUT", `/api/chat/messages/${messageId}/edit`, body),

  openViewOnce: (messageId: string) =>
    request<{
      message_id: string; content: string | null; encrypted_content: string | null;
      signature?: string | null; message_type: string; file_id: string | null;
      already_viewed: boolean;
    }>("POST", `/api/chat/messages/${messageId}/view-once`),

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

  toggleReaction: (messageId: string, tag: string, encEmoji: string) =>
    request<ReactionResponse[]>("POST", `/api/chat/messages/${messageId}/react`, { tag, enc_emoji: encEmoji }),

  globalSearch: (query: string) =>
    request<MessageResponse[]>("GET", `/api/chat/search-global?q=${encodeURIComponent(query)}`),

  uploadFile: async (file: File, fileType: string, onProgress?: (percent: number) => void, isEncrypted = false): Promise<FileUploadResponse> => {
    const token = getToken()
    const csrf = getCsrfToken()
    const form = new FormData()
    form.append("file", file)
    form.append("file_type", fileType)
    form.append("is_encrypted", isEncrypted ? "true" : "false")

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
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
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

  // Stable blob URL via blobManager (cached, revocable, decrypt-aware)
  getFileBlobUrl: async (fileId: string, decrypt?: (blob: Blob) => Promise<Blob>): Promise<string> => {
    const { getOrCreateBlobUrl } = await import("./blobManager")
    return getOrCreateBlobUrl(fileId, decrypt ? { decrypt } : undefined)
  },

  fetchFileBlob: async (fileId: string): Promise<Blob> => {
    const token = getToken()
    const res = await fetch(`${BASE_URL}/api/files/download/${fileId}?token=${encodeURIComponent(token || "")}`)
    if (!res.ok) throw new ApiError(res.status, "Ошибка скачивания")
    return res.blob()
  },

  downloadFile: async (fileId: string, filename: string, decrypt?: (blob: Blob) => Promise<Blob>) => {
    const token = getToken()
    // Prefer blobManager cache + stable revoke semantics
    try {
      const { downloadBlobUrl } = await import("./blobManager")
      await downloadBlobUrl(fileId, filename, decrypt)
      return
    } catch {}
    const res = await fetch(`${BASE_URL}/api/files/download/${fileId}?token=${encodeURIComponent(token || "")}`)
    if (!res.ok) throw new ApiError(res.status, "Ошибка скачивания")
    let blob = await res.blob()
    if (decrypt) blob = await decrypt(blob)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename || "file"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 30000)
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

  // Side-effect-free SPK check (unlike getBundle, does NOT claim an OPK).
  getSignedPrekey: (userId: string) =>
    request<{ public_key: string; signature: string }>("GET", `/api/keys/signed-prekey/${userId}`),

  uploadOneTimePrekeys: (publicKeys: string[]) =>
    request<{ count: number }>("POST", "/api/keys/one-time", { public_keys: publicKeys }),

  getBundle: (userId: string) =>
    request<{ identity_key: string; signed_prekey: string; signed_prekey_signature: string; one_time_prekey: string | null; registration_id: number }>("GET", `/api/keys/bundle/${userId}`),

  getOneTimePrekeyCount: (userId: string) =>
    request<{ count: number }>("GET", `/api/keys/one-time-count/${userId}`),

  getIdentityKeys: (userId: string) =>
    request<{ user_id: string; identity_key: string; public_key: string }>("GET", `/api/auth/user/${userId}/identity-keys`),

  setToken: (token: string, refreshToken?: string) => {
    localStorage.setItem("token", token)
    if (refreshToken) localStorage.setItem("refresh_token", refreshToken)
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
    localStorage.removeItem("refresh_token")
    localStorage.removeItem("user")
  },
}
