import { useState, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"
import { p2pClient } from "../services/p2p"
import {
  loadKeys as loadE2EKeys,
  encryptMessage,
  decryptMessage,
  isE2EEnabled,
  type E2EKeys,
} from "../services/e2e"
import { getGroupKeyForChat, encryptGroupMessage, decryptGroupMessage } from "../services/groupE2E"
import TopBar from "../components/TopBar"
import ChatListItem from "../components/ChatListItem"
import ContactListItem from "../components/ContactListItem"
import GroupInviteItem from "../components/GroupInviteItem"
import MessageBubble from "../components/MessageBubble"
import EmojiPicker from "../components/EmojiPicker"
import AddContactModal from "../components/AddContactModal"
import CreateChatModal from "../components/CreateChatModal"
import ForwardModal from "../components/ForwardModal"
import NotificationToast from "../components/NotificationToast"
import { sendDesktopNotification, initNotifications } from "../services/notifications"
import BookmarksList from "../components/BookmarksList"
import UserProfileModal from "../components/UserProfileModal"
import GroupSettings from "../components/GroupSettings"
import GlobalSearch from "../components/GlobalSearch"
import FileManager from "../components/FileManager"
import StickerPicker from "../components/StickerPicker"
import LinkPreview from "../components/LinkPreview"
import { clearPin } from "../services/pinLock"
import type { ChatResponse, ContactResponse, GroupInviteResponse, UserResponse, MessageResponse } from "../types"

function getCurrentUser(): UserResponse {
  try {
    return JSON.parse(localStorage.getItem("user") || "null") || { id: "self", username: "user", first_name: "", is_online: true }
  } catch {
    return { id: "self", username: "user", first_name: "", is_online: true }
  }
}

const DRAFTS_KEY = "nurchat_drafts"
function getDraft(chatId: string): string {
  try { return (JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>)[chatId] || "" } catch { return "" }
}
function saveDraft(chatId: string, text: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>
    if (text) drafts[chatId] = text; else delete drafts[chatId]
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {}
}
function removeDraft(chatId: string) { saveDraft(chatId, "") }
export function getDraftForChat(chatId: string): string { return getDraft(chatId) }

type Tab = "chats" | "contacts" | "invites" | "bookmarks" | "files"

import { WS_BASE, avatarUrl } from "../config"

export default function ChatPage() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<UserResponse>(getCurrentUser)
  const [tab, setTab] = useState<Tab>("chats")
  const [chats, setChats] = useState<ChatResponse[]>([])
  const [contacts, setContacts] = useState<ContactResponse[]>([])
  const [invites, setInvites] = useState<GroupInviteResponse[]>([])
  const [search, setSearch] = useState("")
  const [selectedChat, setSelectedChat] = useState<ChatResponse | null>(null)
  const [messages, setMessages] = useState<MessageResponse[]>([])
  const [input, setInput] = useState("")
  const [showEmoji, setShowEmoji] = useState(false)
  const [replyTo, setReplyTo] = useState<MessageResponse | null>(null)
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({})
  const [showAddContact, setShowAddContact] = useState(false)
  const [showCreateChat, setShowCreateChat] = useState(false)
  const [showForward, setShowForward] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionIndex, setMentionIndex] = useState(-1)
  const [p2pConnected, setP2pConnected] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
const [uploadProgress, setUploadProgress] = useState(0)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, boolean>>>({})
  const [onlineUsers, setOnlineUsers] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<MessageResponse[]>([])
  const [searching, setSearching] = useState(false)
  const [toast, setToast] = useState<{ id: string; title: string; body: string; chatId?: string } | null>(null)
  const [incomingCall, setIncomingCall] = useState<{ callId: string; callerId: string; callerName: string; callType: string } | null>(null)
  const [profileUser, setProfileUser] = useState<UserResponse | null>(null)
  const [showGroupSettings, setShowGroupSettings] = useState(false)
  const [e2eKeys] = useState<E2EKeys | null>(loadE2EKeys)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set())
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [pinnedMessage, setPinnedMessage] = useState<MessageResponse | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) as React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  const chatIdRef = useRef<string | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadChats = useCallback(async () => {
    try {
      const data = await api.getChats()
      setChats(data || [])
    } catch { setChats([]) }
  }, [])

  const loadContacts = useCallback(async () => {
    try {
      const data = await api.getContacts()
      setContacts(data || [])
    } catch { setContacts([]) }
  }, [])

  const loadInvites = useCallback(async () => {
    try {
      const data = await api.getGroupInvites()
      setInvites(data || [])
    } catch { setInvites([]) }
  }, [])

  const handleWsEvent = useCallback(async (msg: any) => {
    const event = msg.event
    let data = msg.data || {}

    switch (event) {
      case "typing": {
        if (data.chat_id && data.user_id !== currentUser.id) {
          setTypingUsers((prev) => ({
            ...prev,
            [data.chat_id]: { ...prev[data.chat_id], [data.user_id]: data.is_typing }
          }))
          if (data.is_typing) {
            setTimeout(() => {
              setTypingUsers((prev) => {
                const chatTyping = { ...prev[data.chat_id] }
                delete chatTyping[data.user_id]
                return { ...prev, [data.chat_id]: chatTyping }
              })
            }, 4000)
          }
        }
        break
      }
      case "user_online": {
        if (data.user_id) {
          setOnlineUsers((prev) => ({ ...prev, [data.user_id]: true }))
        }
        break
      }
      case "user_offline": {
        if (data.user_id) {
          setOnlineUsers((prev) => ({ ...prev, [data.user_id]: false }))
        }
        break
      }
      case "message": {
        if (data.chat_id === chatIdRef.current && data.user_id !== currentUser.id) {
          // Decrypt E2E message if needed
          if (data.encrypted_content && e2eKeys && selectedChat) {
            const peer = selectedChat.participants.find(p => p.id !== data.user_id)
            if (peer?.public_key) {
              try {
                const envelope = JSON.parse(data.encrypted_content)
                const plain = await decryptMessage(envelope, e2eKeys, peer.public_key, data.chat_id)
                data = { ...data, content: plain || "[не удалось расшифровать]" }
              } catch {
                data = { ...data, content: "[ошибка расшифровки]" }
              }
            }
          }
          setMessages((prev) => [...prev, data])
        }
        loadChats()
        if (data.chat_id !== chatIdRef.current) {
          const sender = data.username || "Пользователь"
          const preview = (data.content || "").slice(0, 50)
          setToast({ id: data.id, title: sender, body: preview, chatId: data.chat_id })
          sendDesktopNotification(sender, preview, data.chat_id)
        }
        break
      }
      case "message_delivered": {
        if (data.chat_id === chatIdRef.current && data.message_id) {
          setMessages((prev) => prev.map((m) =>
            m.id === data.message_id ? { ...m, is_read: true } : m
          ))
        }
        break
      }
      case "delete_message": {
        if (data.message_id) {
          setMessages((prev) => prev.map((m) =>
            m.id === data.message_id
              ? { ...m, is_deleted: true, deleted_for_all: data.delete_for_all || false }
              : m
          ))
        }
        break
      }
      case "edit_message": {
        if (data.message_id && data.new_content) {
          setMessages((prev) => prev.map((m) =>
            m.id === data.message_id ? { ...m, content: data.new_content } : m
          ))
        }
        break
      }
      case "reaction_update": {
        if (data.message_id && data.reactions) {
          const grouped: Record<string, string[]> = {}
          for (const r of data.reactions) {
            if (!grouped[r.emoji]) grouped[r.emoji] = []
            grouped[r.emoji].push(r.user_id)
          }
          setReactions((prev) => ({ ...prev, [data.message_id]: grouped }))
        }
        break
      }
      case "call_incoming": {
        setIncomingCall({
          callId: data.call_id,
          callerId: data.caller_id,
          callerName: data.caller_name || "Пользователь",
          callType: data.call_type || "audio",
        })
        break
      }
      case "call_accept_response": {
        // Принятие звонка из другого клиента — переходим на страницу звонка
        if (data.call_id && data.caller_id) {
          navigate(`/call/${data.caller_id}/audio`)
        }
        break
      }
      case "call_reject_response": {
        setIncomingCall(null)
        break
      }
    }
  }, [currentUser.id, loadChats])

  // WebSocket connection
  useEffect(() => {
    const userId = currentUser.id
    const token = localStorage.getItem("token")
    if (!token || userId === "self") return

    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/chat/${userId}?token=${encodeURIComponent(token!)}`)
      wsRef.current = ws

      ws.onopen = () => {
        console.log("WS connected")
      }

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          handleWsEvent(msg)
        } catch (e) { console.error("WS message parse error:", e) }
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [currentUser.id, handleWsEvent, e2eKeys, selectedChat])

  // Send typing indicator
  const sendTyping = useCallback((isTyping: boolean) => {
    const chatId = chatIdRef.current
    if (!chatId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({
      event: "typing",
      data: { chat_id: chatId, is_typing: isTyping }
    }))
  }, [])

  useEffect(() => {
    setCurrentUser(getCurrentUser())
    loadChats()
    loadContacts()
    loadInvites()
    initNotifications()
  }, [loadChats, loadContacts, loadInvites])

  // P2P auto-connect
  useEffect(() => {
    const token = localStorage.getItem("token")
    const user = JSON.parse(localStorage.getItem("user") || "null")
    const p2pKeys = localStorage.getItem("p2p_keys")
    if (user && token && p2pKeys && !p2pClient.isConnected) {
      p2pClient.connect(user.id, token)
    }
    return () => {
      // Don't disconnect on unmount — keep P2P alive
    }
  }, [])

  // Track P2P peer connections for status indicator + auto-initiate DataChannel
  useEffect(() => {
    const unsub = p2pClient.on((event) => {
      if (event.type === "peer_connected" && event.data?.user_id) {
        setP2pConnected((prev) => {
          const next = new Set(prev)
          next.add(event.data.user_id)
          return next
        })
      } else if (event.type === "peer_disconnected" && event.data?.user_id) {
        setP2pConnected((prev) => {
          const next = new Set(prev)
          next.delete(event.data.user_id)
          return next
        })
      } else if (event.type === "peer_found" && event.data?.user_id) {
        if (selectedChat && !selectedChat.is_group && selectedChat.participants.length === 2) {
          const peer = selectedChat.participants.find(p => p.id === event.data.user_id)
          if (peer) {
            p2pClient.initiateDirectConnection(peer.id)
          }
        }
      }
    })
    return unsub
  }, [selectedChat])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // P2P DataChannel message listener
  useEffect(() => {
    const unsub = p2pClient.on((event) => {
      if (event.type === "message_received" && event.data) {
        const d = event.data
        const senderId = d.sender_id || d.user_id
        // Only process if we're in a chat with this sender
        if (selectedChat && senderId && selectedChat.participants.some(p => p.id === senderId)) {
          const msgId = d.message_id || d.id || `p2p_${Date.now()}`
          // Check if we already have this message (avoid duplicates)
          setMessages((prev) => {
            if (prev.some(m => m.id === msgId)) return prev
            const peer = selectedChat.participants.find(p => p.id === senderId)
            return [...prev, {
              id: msgId,
              chat_id: selectedChat.id,
              user_id: senderId,
              content: d.content || "[encrypted]",
              message_type: "text",
              created_at: d.timestamp || d.created_at || new Date().toISOString(),
              user: peer || currentUser,
              username: peer?.username || "Пользователь",
              first_name: peer?.first_name || "",
              is_read: true,
              is_deleted: false,
              encrypted_content: d.encrypted_content,
              reactions: {},
            }]
          })
        }
      }
    })
    return unsub
  }, [selectedChat])

  useEffect(() => {
    if (selectedChat) {
      chatIdRef.current = selectedChat.id
      setSearchQuery("")
      setSearchResults([])
    }
  }, [selectedChat])

  const decryptMessages = useCallback(async (msgs: MessageResponse[], chat: ChatResponse): Promise<MessageResponse[]> => {
    if (!e2eKeys) return msgs
    if (!isE2EEnabled(chat.participants, e2eKeys)) return msgs
    const peer = chat.participants.find(p => p.id !== currentUser.id)
    if (!peer?.public_key) return msgs
    const results: MessageResponse[] = []

    // Try to get group key for group chats
    let groupKey: CryptoKey | null = null
    if (chat.is_group) {
      try {
        groupKey = await getGroupKeyForChat(chat.id)
      } catch {}
    }

    for (const msg of msgs) {
      if (msg.encrypted_content) {
        try {
          const envelope = JSON.parse(msg.encrypted_content)
          // Group E2E
          if (envelope.group_encrypted && groupKey) {
            try {
              const plain = await decryptGroupMessage(envelope.group_encrypted, groupKey)
              results.push({ ...msg, content: plain || "[не удалось расшифровать]" })
            } catch {
              results.push({ ...msg, content: "[ошибка расшифровки группы]" })
            }
          } else {
            // 1-on-1 E2E
            const plain = await decryptMessage(envelope, e2eKeys, peer.public_key, chat.id)
            results.push({ ...msg, content: plain || "[не удалось расшифровать]" })
          }
        } catch {
          results.push({ ...msg, content: "[ошибка расшифровки]" })
        }
      } else {
        results.push(msg)
      }
    }
    return results
  }, [e2eKeys, currentUser.id])

  const handleSelectChat = useCallback((chatId: string) => {
    const chat = chats.find((c) => c.id === chatId)
    if (chat) {
      // Save draft for current chat before switching
      if (selectedChat) saveDraft(selectedChat.id, input)
      setSelectedChat(chat)
      setMessages([])
      setReplyTo(null)
      setShowEmoji(false)
      setShowStickers(false)
      setHasMore(true)
      // Restore draft for new chat
      setInput(getDraft(chatId))
      api.getChatMessages(chatId, 0, 50)
        .then((msgs) => decryptMessages(msgs, chat))
        .then((decrypted) => {
          setMessages(decrypted)
          setHasMore(decrypted.length >= 50)
        })
        .catch((e) => {
          console.error("Load messages failed:", e)
        })
      // Load pinned messages
      api.getPinnedMessages(chatId)
        .then((pins) => {
          if (pins.length > 0) setPinnedMessage(pins[0].message)
          else setPinnedMessage(null)
        })
        .catch(() => setPinnedMessage(null))

      // Initiate P2P DataChannel for private chats (2 participants, no group)
      if (!chat.is_group && chat.participants.length === 2) {
        const peer = chat.participants.find(p => p.id !== currentUser.id)
        if (peer && peer.id !== currentUser.id) {
          p2pClient.initiateDirectConnection(peer.id)
        }
      }
    }
  }, [chats, decryptMessages, currentUser])

  const loadMoreMessages = useCallback(async () => {
    if (!selectedChat || loadingMore || !hasMore) return
    setLoadingMore(true)
    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0

    try {
      const older = await api.getChatMessages(selectedChat.id, messages.length, 50)
      const decrypted = await decryptMessages(older, selectedChat)
      setMessages((prev) => [...decrypted, ...prev])
      setHasMore(older.length >= 50)
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevScrollHeight
        })
      }
    } catch (e) {
      console.error("Load more messages failed:", e)
    } finally {
      setLoadingMore(false)
    }
  }, [selectedChat, messages.length, loadingMore, hasMore, decryptMessages])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      if (container.scrollTop < 80 && !loadingMore && hasMore && selectedChat) {
        loadMoreMessages()
      }
    }
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [loadingMore, hasMore, selectedChat, loadMoreMessages])

  // Save draft on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (selectedChat && input) saveDraft(selectedChat.id, input)
    }
    window.addEventListener("beforeunload", handleUnload)
    return () => window.removeEventListener("beforeunload", handleUnload)
  }, [selectedChat, input])

  const handlePin = useCallback(async (chatId: string) => {
    try { await api.pinChat(chatId, true); loadChats() } catch (e) {
      setErrorToast("Не удалось закрепить чат")
      console.error("Pin chat failed:", e)
    }
  }, [loadChats])

  const handleMute = useCallback(async (chatId: string) => {
    try {
      const chat = chats.find((c) => c.id === chatId)
      await api.muteChat(chatId, !chat?.is_muted)
      loadChats()
    } catch (e) {
      setErrorToast("Не удалось изменить уведомления")
      console.error("Mute chat failed:", e)
    }
  }, [chats, loadChats])

  const handleExportChat = useCallback(async () => {
    if (!selectedChat) return
    try {
      const data = await api.exportChat(selectedChat.id, "json")
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `chat_${selectedChat.name || selectedChat.id}_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setToast({ id: "export", title: "Экспорт", body: "Экспорт завершён" })
    } catch (e) {
      setErrorToast("Не удалось экспортировать чат")
      console.error("Export chat failed:", e)
    }
  }, [selectedChat])

  const handleRemoveContact = useCallback(async (contactId: string) => {
    try { await api.removeContact(contactId); loadContacts() } catch (e) {
      setErrorToast("Не удалось удалить контакт")
      console.error("Remove contact failed:", e)
    }
  }, [loadContacts])

  const handleStartChat = useCallback(async (userId: string) => {
    try {
      const chat = await api.createChat("", [userId], false)
      loadChats()
      setSelectedChat(chat)
      setTab("chats")
      setMessages([])
    } catch (e) {
      setErrorToast("Не удалось создать чат")
      console.error("Start chat failed:", e)
    }
  }, [loadChats])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await api.deleteChat(chatId)
      if (selectedChat?.id === chatId) { setSelectedChat(null); setMessages([]) }
      loadChats()
    } catch (e) {
      setErrorToast("Не удалось удалить чат")
      console.error("Delete chat failed:", e)
    }
  }, [loadChats, selectedChat])

  const handlePinMessage = useCallback(async (messageId: string) => {
    if (!selectedChat) return
    try {
      const pins = await api.getPinnedMessages(selectedChat.id)
      const isPinned = pins.some(p => p.message_id === messageId)
      if (isPinned) {
        await api.unpinMessage(selectedChat.id, messageId)
      } else {
        await api.pinMessage(selectedChat.id, messageId)
      }
      // Refresh pinned
      const updatedPins = await api.getPinnedMessages(selectedChat.id)
      setPinnedMessage(updatedPins.length > 0 ? updatedPins[0].message : null)
    } catch (e) {
      setErrorToast("Не удалось закрепить сообщение")
      console.error("Pin message failed:", e)
    }
  }, [selectedChat])

  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    try { await api.acceptGroupInvite(inviteId); loadInvites(); loadChats() } catch (e) {
      setErrorToast("Не удалось принять приглашение")
      console.error("Accept invite failed:", e)
    }
  }, [loadChats, loadInvites])

  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    try { await api.declineGroupInvite(inviteId); loadInvites() } catch (e) {
      setErrorToast("Не удалось отклонить приглашение")
      console.error("Decline invite failed:", e)
    }
  }, [loadInvites])

  const handleAddContact = useCallback(async (userId: string) => {
    try { await api.addContact(userId); setShowAddContact(false); loadContacts() } catch (e) {
      setErrorToast("Не удалось добавить контакт")
      console.error("Add contact failed:", e)
    }
  }, [loadContacts])

  const handleCreateChat = useCallback(async (participantIds: string[], name: string | null, isSecret?: boolean, secretTtl?: number) => {
    try {
      const isGroup = participantIds.length > 1
      const chat = await api.createChat(name || "", participantIds, isGroup, isSecret || false, secretTtl || 0)
      setShowCreateChat(false)
      loadChats()
      setSelectedChat(chat)
      setTab("chats")
      setMessages([])
    } catch (e) {
      setErrorToast("Не удалось создать чат")
      console.error("Create chat failed:", e)
    }
  }, [loadChats])

  const insertMention = useCallback((username: string) => {
    const atPos = input.lastIndexOf("@", mentionIndex >= 0 ? mentionIndex : input.length)
    if (atPos >= 0) {
      const before = input.slice(0, atPos)
      const after = input.slice(atPos + mentionQuery.length + 1)
      setInput(before + "@" + username + " " + after)
    }
    setMentionQuery("")
    setMentionIndex(-1)
    inputRef.current?.focus()
  }, [input, mentionQuery, mentionIndex])

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    // Emit typing via WS
    if (chatIdRef.current) {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      sendTyping(true)
      typingTimerRef.current = setTimeout(() => sendTyping(false), 3000)
    }
    // Debounced draft save
    if (selectedChat) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      draftTimerRef.current = setTimeout(() => saveDraft(selectedChat.id, value), 500)
    }
    // @mentions
    const cursorPos = inputRef.current?.selectionStart || value.length
    const beforeCursor = value.slice(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx >= 0) {
      const afterAt = beforeCursor.slice(atIdx + 1)
      if (afterAt.length <= 20 && !afterAt.includes(" ")) {
        setMentionQuery(afterAt)
        setMentionIndex(cursorPos)
        return
      }
    }
    setMentionQuery("")
    setMentionIndex(-1)
  }, [sendTyping, selectedChat])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !selectedChat) return
    let content = text
    if (replyTo) {
      const sender = replyTo.user?.username || "Пользователь"
      content = `↩️ Ответ ${sender}\n${text}`
    }

    // E2E: encrypt if both users have public keys
    const myKeys = loadE2EKeys()
    let encryptedContent: string | undefined
    let signature: string | undefined
    if (myKeys && isE2EEnabled(selectedChat.participants, myKeys)) {
      try {
        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
        if (peer?.public_key) {
          const envelope = await encryptMessage(content, myKeys, peer.public_key, selectedChat.id, currentUser.id)
          encryptedContent = JSON.stringify(envelope)
          signature = envelope.signature
          content = "[encrypted]"
        }
      } catch (e) {
        console.error("E2E encrypt failed, sending plaintext:", e)
      }
    }

    // Group E2E: encrypt with group key if available
    if (!encryptedContent && selectedChat.is_group) {
      try {
        const groupKey = await getGroupKeyForChat(selectedChat.id)
        if (groupKey) {
          const encrypted = await encryptGroupMessage(content, groupKey)
          encryptedContent = JSON.stringify({ group_encrypted: encrypted })
          content = "[encrypted]"
        }
      } catch (e) {
        console.error("Group E2E encrypt failed:", e)
      }
    }

    // Try P2P DataChannel for private chats (2 participants, no group)
    let sentViaP2P = false
    if (!selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer) {
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const payload = encryptedContent || content
        const sent = p2pClient.sendMessageOrQueue(peer.id, msgId, payload)
        sentViaP2P = true
        const localMsg: MessageResponse = {
          id: msgId,
          chat_id: selectedChat.id,
          user_id: currentUser.id,
          content: encryptedContent ? text : content,
          message_type: "text",
          created_at: new Date().toISOString(),
          user: currentUser,
          is_read: true,
          is_deleted: false,
          encrypted_content: encryptedContent,
          signature: signature,
          reactions: {},
        }
        setMessages((prev) => [...prev, localMsg])
        if (sent) {
          loadChats()
        }
      }
    }

    // Fallback to HTTP API
    if (!sentViaP2P) {
      try {
        const msg = await api.sendMessage(selectedChat.id, content, "text", undefined, encryptedContent, signature)
        setMessages((prev) => [...prev, msg])
        loadChats()
      } catch (e) { console.error("Send message failed:", e) }
    }
    setInput("")
    setReplyTo(null)
    setMentionQuery("")
    setMentionIndex(-1)
    sendTyping(false)
    if (selectedChat) removeDraft(selectedChat.id)
  }, [input, selectedChat, replyTo, currentUser, loadChats, sendTyping])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery) {
      if (e.key === "ArrowDown") { e.preventDefault(); return }
      if (e.key === "ArrowUp") { e.preventDefault(); return }
      if (e.key === "Enter" || e.key === "Tab") {
        const candidates = selectedChat?.participants.filter(
          (p) => p.id !== currentUser.id && p.username.toLowerCase().includes(mentionQuery.toLowerCase())
        ) || []
        if (candidates.length > 0) {
          e.preventDefault()
          insertMention(candidates[0].username)
          return
        }
      }
      if (e.key === "Escape") { setMentionQuery(""); setMentionIndex(-1); return }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmojiSelect = (emoji: string) => {
    setInput((prev) => prev + emoji)
  }

  const handleReply = useCallback((messageId: string) => {
    const msg = messages.find((m) => m.id === messageId)
    if (msg) setReplyTo(msg)
  }, [messages])

  const handleReaction = useCallback(async (messageId: string, emoji: string, add: boolean) => {
    const peerId = currentUser.id
    // Optimistic update
    setReactions((prev) => {
      const msgReactions = { ...(prev[messageId] || {}) }
      const reactors = [...(msgReactions[emoji] || [])]
      if (add) {
        if (!reactors.includes(peerId)) reactors.push(peerId)
      } else {
        const idx = reactors.indexOf(peerId)
        if (idx >= 0) reactors.splice(idx, 1)
      }
      if (reactors.length > 0) msgReactions[emoji] = reactors
      else delete msgReactions[emoji]
      return { ...prev, [messageId]: msgReactions }
    })
    // Persist to server
    try {
      const serverReactions = await api.toggleReaction(messageId, emoji)
      // Rebuild from server response
      const grouped: Record<string, string[]> = {}
      for (const r of serverReactions) {
        if (!grouped[r.emoji]) grouped[r.emoji] = []
        grouped[r.emoji].push(r.user_id)
      }
      setReactions((prev) => ({ ...prev, [messageId]: grouped }))
    } catch {
      // Revert on failure
      setReactions((prev) => {
        const msgReactions = { ...(prev[messageId] || {}) }
        const reactors = [...(msgReactions[emoji] || [])]
        if (!add) {
          if (!reactors.includes(peerId)) reactors.push(peerId)
        } else {
          const idx = reactors.indexOf(peerId)
          if (idx >= 0) reactors.splice(idx, 1)
        }
        if (reactors.length > 0) msgReactions[emoji] = reactors
        else delete msgReactions[emoji]
        return { ...prev, [messageId]: msgReactions }
      })
    }
  }, [currentUser.id])

  const handleForward = useCallback(async (messageId: string, targetChatIds: string[]) => {
    try {
      await api.forwardMessage(messageId, targetChatIds)
      setShowForward(null)
    } catch (e) {
      setErrorToast("Не удалось переслать сообщение")
      console.error("Forward message failed:", e)
    }
  }, [])

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    try {
      await api.editMessage(messageId, newContent)
      setMessages((prev) => prev.map((m) =>
        m.id === messageId ? { ...m, content: newContent } : m
      ))
    } catch (e) {
      setErrorToast("Не удалось отредактировать сообщение")
      console.error("Edit message failed:", e)
    }
  }, [])

  const handleDeleteMessage = useCallback(async (messageId: string, deleteForAll = false) => {
    try {
      await api.deleteMessage(messageId, deleteForAll)
      if (deleteForAll) {
        setMessages((prev) => prev.map((m) =>
          m.id === messageId ? { ...m, is_deleted: true, deleted_for_all: true } : m
        ))
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== messageId))
      }
    } catch (e) {
      setErrorToast("Не удалось удалить сообщение")
      console.error("Delete message failed:", e)
    }
  }, [])

  const handleBookmark = useCallback(async (messageId: string) => {
    const chatId = selectedChat?.id
    if (!chatId) return
    const isBookmarked = bookmarkedIds.has(messageId)
    try {
      if (isBookmarked) {
        await api.removeBookmark(messageId)
        setBookmarkedIds((prev) => { const next = new Set(prev); next.delete(messageId); return next })
      } else {
        await api.addBookmark(messageId, chatId)
        setBookmarkedIds((prev) => new Set(prev).add(messageId))
      }
    } catch (e) {
      setErrorToast(isBookmarked ? "Не удалось убрать из избранного" : "Не удалось добавить в избранное")
      console.error("Bookmark failed:", e)
    }
  }, [selectedChat, bookmarkedIds])

  const handleSearchMessages = useCallback(async () => {
    if (!searchQuery.trim() || !selectedChat) return
    setSearching(true)
    try {
      const results = await api.searchMessages(selectedChat.id, searchQuery)
      setSearchResults(results || [])
    } catch (e) { console.error("Search messages failed:", e) }
    setSearching(false)
  }, [searchQuery, selectedChat])

  const handleFilePick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedChat) return
    setUploading(true)
    setUploadProgress(0)
    try {
      const fileType = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "file"
      const uploaded = await api.uploadFile(file, fileType, (p) => setUploadProgress(p))
      const msg = await api.sendMessage(selectedChat.id, file.name, fileType, uploaded.id)
      setMessages((prev) => [...prev, msg])
      loadChats()
    } catch (e) {
      console.error("File upload failed:", e)
      setErrorToast("Ошибка загрузки файла")
    }
    setUploading(false)
    setUploadProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [selectedChat, loadChats])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" })
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        setRecordingTime(0)
        if (chunks.length === 0 || !selectedChat) return
        const blob = new Blob(chunks, { type: mr.mimeType })
        const file = new File([blob], `voice_${Date.now()}.webm`, { type: mr.mimeType })
        setUploading(true)
        try {
          const uploaded = await api.uploadFile(file, "voice")
          const msg = await api.sendMessage(selectedChat.id, "Голосовое сообщение", "voice", uploaded.id)
          setMessages((prev) => [...prev, msg])
          loadChats()
        } catch (e) { console.error("Voice upload failed:", e) }
        setUploading(false)
      }
      mr.start()
      setMediaRecorder(mr)
      setRecording(true)
      recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
    } catch (e) { console.error("Microphone access denied:", e) }
  }, [selectedChat, loadChats])

  const stopRecording = useCallback(() => {
    mediaRecorder?.stop()
    setMediaRecorder(null)
    setRecording(false)
  }, [mediaRecorder])

  const handleProfile = useCallback(() => { navigate("/profile") }, [navigate])
  const handleLogout = useCallback(() => { api.clearToken(); clearPin(); navigate("/login", { replace: true }) }, [navigate])
  const handleSwitchAccount = useCallback(() => { api.clearToken(); clearPin(); navigate("/login", { replace: true }) }, [navigate])
  const handleSettings = useCallback(() => { navigate("/settings") }, [navigate])
  const handleLegal = useCallback(() => { navigate("/legal") }, [navigate])
  const handleP2P = useCallback(() => { navigate("/p2p") }, [navigate])

  const handleAcceptCall = useCallback(() => {
    if (!incomingCall) return
    wsRef.current?.send(JSON.stringify({
      event: "call_accept",
      data: { call_id: incomingCall.callId }
    }))
    setIncomingCall(null)
    navigate(`/call/${incomingCall.callerId}/${incomingCall.callType}?call_id=${incomingCall.callId}`)
  }, [incomingCall, navigate])

  const handleRejectCall = useCallback(() => {
    if (!incomingCall) return
    wsRef.current?.send(JSON.stringify({
      event: "call_reject",
      data: { call_id: incomingCall.callId }
    }))
    setIncomingCall(null)
  }, [incomingCall])

  const handleViewProfile = useCallback((user: UserResponse) => {
    setProfileUser(user)
  }, [])

  const mentionCandidates = mentionQuery && selectedChat
    ? selectedChat.participants.filter(
        (p) => p.id !== currentUser.id && p.username.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : []

  const filteredChats = chats.filter((c) => {
    if (!search) return true
    const name = c.is_group ? c.name : c.participants.find((p) => p.id !== currentUser.id)?.username
    return name?.toLowerCase().includes(search.toLowerCase())
  })

  const selectedChatName = selectedChat
    ? selectedChat.is_group
      ? (selectedChat.name || "Группа")
      : selectedChat.participants.find((p) => p.id !== currentUser.id)?.username || "Чат"
    : ""

  const selectedChatAvatar = selectedChatName[0]?.toUpperCase() || "?"
  const isSelectedGroup = selectedChat?.is_group || false

  // Get typing text
  const currentTyping = selectedChat ? typingUsers[selectedChat.id] : undefined
  const typingNames = currentTyping
    ? Object.entries(currentTyping)
        .filter(([, v]) => v)
        .map(([uid]) => {
          const p = selectedChat?.participants.find((pp) => pp.id === uid)
          return p?.username || "Пользователь"
        })
    : []

  const currentUserAvatarUrl = avatarUrl(currentUser.avatar_path)

  return (
    <div className="chat-page">
      <TopBar
        username={currentUser.username}
        avatarChar={currentUser.username[0]?.toUpperCase() || "?"}
        avatarUrl={currentUserAvatarUrl}
        onProfile={handleProfile}
        onLogout={handleLogout}
        onSwitchAccount={handleSwitchAccount}
        onSettings={handleSettings}
        onLegal={handleLegal}
        onP2P={handleP2P}
      />

      {/* Toast notification */}
      <NotificationToast toast={toast} onClose={() => setToast(null)} onClick={(chatId) => {
        setToast(null)
        if (chatId) handleSelectChat(chatId)
      }} />

      {/* Error toast */}
      {errorToast && (
        <div className="error-toast" onClick={() => setErrorToast(null)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{errorToast}</span>
        </div>
      )}

      {/* Incoming call banner */}
      {incomingCall && (
        <div className="incoming-call-banner">
          <div className="incoming-call-info">
            <span className="incoming-call-icon">📞</span>
            <div>
              <span className="incoming-call-name">{incomingCall.callerName}</span>
              <span className="incoming-call-type">{incomingCall.callType === "video" ? "Видеозвонок" : "Аудиозвонок"}</span>
            </div>
          </div>
          <div className="incoming-call-actions">
            <button className="incoming-call-btn reject" onClick={handleRejectCall} title="Отклонить">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button className="incoming-call-btn accept" onClick={handleAcceptCall} title="Принять">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="chat-body">
        {/* Sidebar */}
        <div className="chat-sidebar">
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${tab === "chats" ? "active" : ""}`} onClick={() => setTab("chats")} title="Чаты">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "contacts" ? "active" : ""}`} onClick={() => setTab("contacts")} title="Контакты">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "bookmarks" ? "active" : ""}`} onClick={() => setTab("bookmarks")} title="Избранное">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "files" ? "active" : ""}`} onClick={() => setTab("files")} title="Файлы">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "invites" ? "active" : ""}`} onClick={() => setTab("invites")} title="Приглашения">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
              {invites.length > 0 && <span className="tab-badge">{invites.length}</span>}
            </button>
          </div>
          <div className="sidebar-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input type="text" placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sidebar-list-header">
            <span className="sidebar-list-title">
              {tab === "chats" ? "Чаты" : tab === "contacts" ? "Контакты" : tab === "files" ? "Файлы" : "Приглашения"}
            </span>
            {(tab === "chats" || tab === "contacts") && (
              <button
                className="sidebar-add-btn"
                title={tab === "chats" ? "Новый чат" : "Добавить контакт"}
                onClick={() => tab === "chats" ? setShowCreateChat(true) : setShowAddContact(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
          </div>
          <div className="sidebar-list">
            {tab === "chats" && (
              <div className="list-scroll">
                {filteredChats.length === 0 && <p className="list-empty">Нет чатов</p>}
                {filteredChats.map((chat) => (
                  <ChatListItem key={chat.id} chat={chat} currentUser={currentUser} onClick={handleSelectChat} onPin={handlePin} onMute={handleMute} onDelete={handleDeleteChat} />
                ))}
              </div>
            )}
            {tab === "contacts" && (
              <div className="list-scroll">
                {contacts.length === 0 && <p className="list-empty">Нет контактов</p>}
                {contacts.map((contact) => (
                  <ContactListItem key={contact.id} contact={contact} onRemove={handleRemoveContact} onStartChat={handleStartChat} />
                ))}
              </div>
            )}
            {tab === "invites" && (
              <div className="list-scroll">
                {invites.length === 0 && <p className="list-empty">Нет приглашений</p>}
                {invites.map((invite) => (
                  <GroupInviteItem key={invite.id} invite={invite} onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
                ))}
              </div>
            )}
            {tab === "bookmarks" && (
              <div className="list-scroll">
                <BookmarksList onSelectMessage={(chatId) => {
                  const chat = chats.find(c => c.id === chatId)
                  if (chat) { setSelectedChat(chat); setTab("chats") }
                }} />
              </div>
            )}
            {tab === "files" && (
              <div className="list-scroll">
                <FileManager onClose={() => setTab("chats")} />
              </div>
            )}
          </div>
        </div>

        {/* Main */}
        <div className="chat-main">
          {!selectedChat ? (
            <div className="chat-placeholder">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2AABEE" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              <h3>NurChat</h3>
              <p>Выберите чат для начала общения</p>
            </div>
          ) : (
            <div className="chat-window">
              {/* Header */}
              <div className="chat-header">
                <div
                  className="ch-avatar clickable"
                  onClick={() => {
                    if (!isSelectedGroup) {
                      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                      if (peer) handleViewProfile(peer)
                    }
                  }}
                >
                  {selectedChatAvatar}
                </div>
                <div className="ch-info">
                  <span
                    className="ch-name"
                    style={!isSelectedGroup ? { cursor: "pointer" } : undefined}
                    onClick={() => {
                      if (!isSelectedGroup) {
                        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                        if (peer) handleViewProfile(peer)
                      }
                    }}
                  >
                    {selectedChatName}
                  </span>
                  <span className="ch-status">
                    {typingNames.length > 0
                      ? `печатает${typingNames.length > 1 ? "ют" : ""} ${typingNames.join(", ")}...`
                      : isSelectedGroup
                        ? `${selectedChat.participants.length} участников`
                        : (() => {
                            const peer = selectedChat.participants.find((p) => p.id !== currentUser.id)
                            const peerId = peer?.id || ""
                            const isOnline = onlineUsers[peerId]
                            const isP2P = p2pConnected.has(peerId)
                            const isConnecting = p2pClient.connectingPeers.has(peerId)
                            if (isOnline && isP2P) return "P2P · в сети"
                            if (isOnline && isConnecting) return "P2P · подключение..."
                            if (isOnline) return "в сети"
                            return "не в сети"
                          })()}
                  </span>
                </div>
                <div className="ch-actions">
                  <button className="ch-btn" title="Поиск по сообщениям" onClick={() => setSearchQuery("")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  <button className="ch-btn" title="Глобальный поиск" onClick={() => setShowGlobalSearch(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  {isSelectedGroup && (
                    <button className="ch-btn" title="Настройки группы" onClick={() => setShowGroupSettings(true)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                    </button>
                  )}
                  {!isSelectedGroup && (
                    <>
                      <button className="ch-btn" title="Аудиозвонок" onClick={() => {
                        const peer = selectedChat?.participants.find(p => p.id !== currentUser.id)
                        if (peer) navigate(`/call/${peer.id}/audio`)
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      </button>
                      <button className="ch-btn" title="Видеозвонок" onClick={() => {
                        const peer = selectedChat?.participants.find(p => p.id !== currentUser.id)
                        if (peer) navigate(`/call/${peer.id}/video`)
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                      </button>
                    </>
                  )}
                  <button className="ch-btn" title="Экспорт чата" onClick={handleExportChat}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  </button>
                </div>
              </div>

              {/* Secret chat banner */}
              {selectedChat?.is_secret && (
                <div className="secret-chat-banner">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <span>Секретный чат · сообщения исчезают через {selectedChat.disappears_after_seconds}с</span>
                </div>
              )}

              {/* Messages */}
              <div className="chat-messages" ref={messagesContainerRef}>
                {/* Pinned message banner */}
                {pinnedMessage && (
                  <div className="pinned-banner" onClick={() => {
                    const el = document.getElementById(`msg-${pinnedMessage.id}`)
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
                  }}>
                    <span className="pinned-banner-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L12 22" /><path d="M17 7L12 2L7 7" /></svg>
                    </span>
                    <div className="pinned-banner-text">
                      <div className="pinned-banner-title">Закреплённое сообщение</div>
                      <div className="pinned-banner-preview">{pinnedMessage.content || "Медиа"}</div>
                    </div>
                    <button className="pinned-banner-close" onClick={(e) => { e.stopPropagation(); setPinnedMessage(null) }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}
                {/* Search mode */}
                {searchQuery && (
                  <div className="search-bar">
                    <input
                      type="text"
                      placeholder="Поиск сообщений..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchMessages()}
                      autoFocus
                    />
                    <button className="search-btn" onClick={handleSearchMessages} disabled={searching}>
                      {searching ? "..." : "Найти"}
                    </button>
                    <button className="search-close" onClick={() => { setSearchQuery(""); setSearchResults([]) }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="search-results">
                {searchResults.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    currentUser={currentUser}
                    isMyMessage={msg.user_id === currentUser.id}
                    reactions={reactions[msg.id]}
                    onReply={handleReply}
                    onDelete={handleDeleteMessage}
                    onForward={(id) => setShowForward(id)}
                    onReaction={handleReaction}
                    onEdit={handleEditMessage}
                    onViewProfile={handleViewProfile}
                    onBookmark={handleBookmark}
                    isBookmarked={bookmarkedIds.has(msg.id)}
                    highlightQuery={searchQuery}
                  />
                ))}
                  </div>
                )}
                {(searchQuery && searchResults.length === 0 && !searching) && (
                  <p className="search-no-results">Ничего не найдено</p>
                )}

                {!searchQuery && loadingMore && (
                  <div className="messages-loading">
                    <div className="messages-spinner" />
                    <span>Загрузка...</span>
                  </div>
                )}
                {!searchQuery && messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    currentUser={currentUser}
                    isMyMessage={msg.user_id === currentUser.id}
                    isRead={msg.is_read}
                    reactions={reactions[msg.id]}
                    onReply={handleReply}
                    onDelete={handleDeleteMessage}
                    onForward={(id) => setShowForward(id)}
                    onReaction={handleReaction}
                    onEdit={handleEditMessage}
                    onViewProfile={handleViewProfile}
                    onBookmark={handleBookmark}
                    isBookmarked={bookmarkedIds.has(msg.id)}
                    onPin={handlePinMessage}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply preview */}
              {replyTo && (
                <div className="reply-preview">
                  <div className="reply-border">
                    <span className="reply-sender">{replyTo.user?.username || "Пользователь"}</span>
                    <span className="reply-text">{replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? "..." : ""}</span>
                  </div>
                  <button className="reply-close" onClick={() => setReplyTo(null)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}

              {/* Link preview */}
              {(() => {
                const urlMatch = input.match(/https?:\/\/[^\s]+/)
                if (urlMatch && !input.includes("\n")) {
                  return <div style={{ padding: "0 12px" }}><LinkPreview url={urlMatch[0]} /></div>
                }
                return null
              })()}

              {/* Input area */}
              <div className="chat-input-area" style={{ position: "relative" }}>
                {mentionCandidates.length > 0 && (
                  <div className="mention-dropdown">
                    {mentionCandidates.map((u) => (
                      <div key={u.id} className="mention-item" onClick={() => insertMention(u.username)}>
                        <span className="mention-at">@</span>
                        <span>{u.username}</span>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                <button className="input-btn" title="Эмодзи" onClick={() => setShowEmoji(!showEmoji)} disabled={recording || uploading}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button className="input-btn" title="Стикеры" onClick={() => setShowStickers(!showStickers)} disabled={recording || uploading}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /><path d="M9 15c1 1 5 1 6 0" /></svg>
                </button>
                <button className="input-btn" title="Прикрепить файл" disabled={recording || uploading} onClick={handleFilePick}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                </button>
                {uploading ? (
                  <div className="chat-input-uploading">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <span>Загрузка...</span>
                      <div style={{
                        flex: 1,
                        height: 4,
                        background: "var(--input-bg)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%",
                          width: `${uploadProgress}%`,
                          background: "var(--tg-blue)",
                          borderRadius: 2,
                          transition: "width 0.2s",
                        }} />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--tg-blue)" }}>{uploadProgress}%</span>
                    </div>
                  </div>
                ) : recording ? (
                  <div className="chat-input-recording">
                    <span className="recording-dot" />
                    <span className="recording-time">{String(Math.floor(recordingTime / 60)).padStart(2, "0")}:{String(recordingTime % 60).padStart(2, "0")}</span>
                    <button className="input-btn record-stop" onClick={stopRecording} title="Остановить запись">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    </button>
                  </div>
                ) : (
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    placeholder="Сообщение... (@ для упоминания)"
                    rows={1}
                    value={input}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                )}
                {!recording && !uploading && (
                  input.trim() ? (
                    <button className="send-btn" onClick={handleSend}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                  ) : (
                    <button className={`input-btn ${recording ? "record-active" : ""}`} title="Голосовое сообщение" onClick={startRecording}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    </button>
                  )
                )}
                {/* Emoji picker */}
                {showEmoji && (
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
                {/* Sticker picker */}
                {showStickers && (
                  <StickerPicker
                    onSelect={(sticker) => { setInput((prev) => prev + sticker); setShowStickers(false); inputRef.current?.focus() }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddContact && (
        <AddContactModal
          existingContactIds={contacts.map((c) => c.contact_user?.id).filter(Boolean)}
          currentUserId={currentUser.id}
          onAdd={handleAddContact}
          onClose={() => setShowAddContact(false)}
        />
      )}
      {showCreateChat && (
        <CreateChatModal
          currentUserId={currentUser.id}
          onCreate={handleCreateChat}
          onClose={() => setShowCreateChat(false)}
        />
      )}
      {showForward && (
        <ForwardModal
          messageId={showForward}
          sourceChatId={selectedChat?.id}
          onForward={handleForward}
          onClose={() => setShowForward(null)}
        />
      )}
      {profileUser && (
        <UserProfileModal
          user={profileUser}
          onClose={() => setProfileUser(null)}
        />
      )}
      {showGroupSettings && selectedChat && selectedChat.is_group && (
        <GroupSettings
          chat={selectedChat}
          currentUser={currentUser}
          onClose={() => setShowGroupSettings(false)}
          onUpdated={() => { loadChats(); }}
        />
      )}
      {showGlobalSearch && (
        <GlobalSearch
          chats={chats}
          onSelect={(chatId: string, _messageId: string) => {
            const chat = chats.find(c => c.id === chatId)
            if (chat) { setSelectedChat(chat); setTab("chats") }
            setShowGlobalSearch(false)
          }}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}
    </div>
  )
}
