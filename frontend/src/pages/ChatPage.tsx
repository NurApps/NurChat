import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import {
  initP2PBridge,
  onP2PBridgeEvent,
  isPeerConnected,
  getPeerId,
  registerPeer,
  connectToUser,
  sendP2PFileMessage,
  sendP2PTyping,
  sendP2POnlineStatus,
} from "../services/p2pBridge"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { useChatSocket } from "../hooks/useChatSocket"
import { useChatMessages } from "../hooks/useChatMessages"
import { useChatActions } from "../hooks/useChatActions"
import { useChatTyping } from "../hooks/useChatTyping"
import { useOfflineQueue } from "../hooks/useOfflineQueue"
import { useMobile } from "../hooks/useMobile"
import OfflineBanner from "../components/OfflineBanner"
import { BottomTabs } from "../components/mobile/BottomTabs"
import { SwipeableRow } from "../components/mobile/SwipeableRow"
import { PullToRefresh } from "../components/mobile/PullToRefresh"
import { MobileMessageInput } from "../components/mobile/MobileMessageInput"
import { loadKeys as loadE2EKeys, decryptMessage, type E2EKeys } from "../services/e2e"
import { checkKeyStatus } from "../services/keyVerification"
import { initNotifications, showNotification } from "../services/notifications"
import { clearPin } from "../services/pinLock"
import { getActiveCall, onCallEvent, type CallInfo } from "../services/callService"
import { avatarUrl } from "../config"
import { useChatStore } from "../store/chatStore"
import TopBar from "../components/TopBar"
import ChatListItem from "../components/ChatListItem"
import ContactListItem from "../components/ContactListItem"
import GroupInviteItem from "../components/GroupInviteItem"
import MessageBubble from "../components/MessageBubble"
import VirtualizedMessageList from "../components/VirtualizedMessageList"
import EmojiPicker from "../components/EmojiPicker"
import AddContactModal from "../components/AddContactModal"
import CreateChatModal from "../components/CreateChatModal"
import ForwardModal from "../components/ForwardModal"
import NotificationToast from "../components/NotificationToast"
import BookmarksList from "../components/BookmarksList"
import UserProfileModal from "../components/UserProfileModal"
import GroupSettings from "../components/GroupSettings"
import GlobalSearch from "../components/GlobalSearch"
import FileManager from "../components/FileManager"
import StickerPicker from "../components/StickerPicker"
import { MessageListSkeleton } from "../components/Skeleton"
import LinkPreview from "../components/LinkPreview"
import MessageInfoModal from "../components/MessageInfoModal"
import InviteModal from "../components/InviteModal"
import type { UserResponse, MessageResponse, PollResponse } from "../types"
import PollCard from "../components/PollCard"
import CreatePollModal from "../components/CreatePollModal"
import ChatSidebar from "../components/ChatSidebar"
import ChatModals from "../components/ChatModals"
import CallOverlay from "../components/CallOverlay"
import GroupCallOverlay from "../components/GroupCallOverlay"

import { getDraft, saveDraft, removeDraft } from "../utils/drafts"

export default function ChatPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useMobile()

  const currentUser = useChatStore((s) => s.currentUser)
  const tab = useChatStore((s) => s.tab)
  const setTab = useChatStore((s) => s.setTab)
  const chats = useChatStore((s) => s.chats)
  const contacts = useChatStore((s) => s.contacts)
  const invites = useChatStore((s) => s.invites)
  const search = useChatStore((s) => s.search)
  const setSearch = useChatStore((s) => s.setSearch)
  const selectedChat = useChatStore((s) => s.selectedChat)
  const onlineUsers = useChatStore((s) => s.onlineUsers)

  const filteredChats = useMemo(() => {
    return chats.filter((c) => {
      if (!search) return true
      const name = c.is_group ? c.name : c.participants.find((p) => p.id !== currentUser.id)?.username
      return name?.toLowerCase().includes(search.toLowerCase())
    })
  }, [chats, search, currentUser.id])

  const input = useChatStore((s) => s.input)
  const showEmoji = useChatStore((s) => s.showEmoji)
  const showStickers = useChatStore((s) => s.showStickers)
  const uploading = useChatStore((s) => s.uploading)
  const uploadProgress = useChatStore((s) => s.uploadProgress)
  const toast = useChatStore((s) => s.toast)
  const errorToast = useChatStore((s) => s.errorToast)
  const incomingCall = useChatStore((s) => s.incomingCall)
  const profileUser = useChatStore((s) => s.profileUser)
  const showAddContact = useChatStore((s) => s.showAddContact)
  const showCreateChat = useChatStore((s) => s.showCreateChat)
  const showGroupSettings = useChatStore((s) => s.showGroupSettings)
  const showGlobalSearch = useChatStore((s) => s.showGlobalSearch)
  const showMessageInfo = useChatStore((s) => s.showMessageInfo)
  const bookmarkedIds = useChatStore((s) => s.bookmarkedIds)
  const p2pConnected = useChatStore((s) => s.p2pConnected)

  const setSelectedChat = useChatStore((s) => s.setSelectedChat)
  const setInput = useChatStore((s) => s.setInput)
  const setShowEmoji = useChatStore((s) => s.setShowEmoji)
  const setShowStickers = useChatStore((s) => s.setShowStickers)
  const setShowAddContact = useChatStore((s) => s.setShowAddContact)
  const setShowCreateChat = useChatStore((s) => s.setShowCreateChat)
  const setOnlineUsers = useChatStore((s) => s.setOnlineUsers)
  const setToast = useChatStore((s) => s.setToast)
  const setErrorToast = useChatStore((s) => s.setErrorToast)
  const setIncomingCall = useChatStore((s) => s.setIncomingCall)
  const setProfileUser = useChatStore((s) => s.setProfileUser)
  const setShowGroupSettings = useChatStore((s) => s.setShowGroupSettings)
  const setShowGlobalSearch = useChatStore((s) => s.setShowGlobalSearch)
  const setShowMessageInfo = useChatStore((s) => s.setShowMessageInfo)
  const setBookmarkedIds = useChatStore((s) => s.setBookmarkedIds)
  const typingUsers = useChatStore((s) => s.typingUsers)
  const setTypingUsers = useChatStore((s) => s.setTypingUsers)
  const setP2pConnected = useChatStore((s) => s.setP2pConnected)
  const setUploading = useChatStore((s) => s.setUploading)
  const setUploadProgress = useChatStore((s) => s.setUploadProgress)
  const loadChats = useChatStore((s) => s.loadChats)
  const loadContacts = useChatStore((s) => s.loadContacts)
  const loadInvites = useChatStore((s) => s.loadInvites)

  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionIndex, setMentionIndex] = useState(-1)
  const [e2eKeys, setE2eKeys] = useState<E2EKeys | null>(null)
  const [keyWarning, setKeyWarning] = useState<string | null>(null)
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<MessageResponse[]>([])
  const [searching, setSearching] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showGroupCall, setShowGroupCall] = useState(false)
  const [showPinnedModal, setShowPinnedModal] = useState(false)
  const [activeCall, setActiveCall] = useState<CallInfo | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  const [callVideoOff, setCallVideoOff] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [polls, setPolls] = useState<PollResponse[]>([])
  const [showCreatePoll, setShowCreatePoll] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    messages, setMessages, loadingMore, initialLoading, hasMore, containerRef: messagesContainerRef, endRef: messagesEndRef,
    loadMessages, loadMore, addMessage, updateMessage, setHasMore,
  } = useChatMessages({ currentUser, e2eKeys })

  const socketTypingCb = useCallback((fn: (prev: Record<string, Record<string, boolean>>) => Record<string, Record<string, boolean>>) => {
    setTypingUsers(fn)
  }, [])

  const { wsRef, chatIdRef } = useChatSocket({
    currentUser, selectedChat,
    onMessage: useCallback(async (data: any) => {
      if (data._update) { updateMessage(data.message_id as string, { is_read: true }); return }
      if (data._delete) { updateMessage(data.message_id as string, { is_deleted: true, deleted_for_all: data.delete_for_all as boolean }); return }
      if (data._edit) { updateMessage(data.message_id as string, { content: data.content as string }); return }
      if (data.encrypted_content && e2eKeys && selectedChat) {
        try {
          const peer = selectedChat.participants.find((p: any) => p.id !== currentUser.id)
          if (peer?.public_key) {
            const envelope = JSON.parse(data.encrypted_content)
            const plain = await decryptMessage(
              envelope, e2eKeys, peer.public_key, selectedChat.id,
            )
            if (plain) data.content = plain
          }
        } catch (e) { console.warn("[WS] decrypt failed:", e) }
      }
      addMessage(data as unknown as MessageResponse)
    }, [addMessage, updateMessage, e2eKeys, currentUser, selectedChat]),
    onChatUpdate: loadChats,
    onToast: setToast,
    onIncomingCall: setIncomingCall,
    onTypingUsers: socketTypingCb,
    onOnlineUsers: setOnlineUsers,
    onMention: useCallback((data) => {
      setToast({
        id: `mention_${data.message_id}`,
        title: `@${data.mentioned_by_username}`,
        body: `СѓРїРѕРјСЏРЅСѓР»(Р°) РІР°СЃ: ${data.content_preview}`,
        chatId: data.chat_id,
      })
    }, [setToast]),
    onReactions: useCallback(() => undefined, []),
    onNavigate: navigate,
  })

  const { isOnline: offlineQueueIsOnline, pendingCount } = useOfflineQueue()

  const sendWs = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(data))
  }, [wsRef])

  const { sendTyping: sendTypingRaw, typingTimerRef } = useChatTyping(sendWs)

  const sendTyping = useCallback((isTyping: boolean) => {
    const chatId = useChatStore.getState().selectedChat?.id
    if (!chatId) return
    sendTypingRaw(isTyping, chatId)
    // Also send via P2P if peer is connected
    const chat = useChatStore.getState().selectedChat
    if (chat && !chat.is_group && chat.participants.length === 2) {
      const peer = chat.participants.find(p => p.id !== currentUser.id)
      if (peer && isPeerConnected(peer.id)) {
        sendP2PTyping(peer.id, chatId, isTyping)
      }
    }
  }, [sendTypingRaw, currentUser.id])

  const {
    replyTo, setReplyTo, showForward, setShowForward, pinnedMessage, setPinnedMessage,
    handleSend: handleSendAction, handleReply, handleReaction, handleForward, handleEditMessage, handleDeleteMessage,
    handlePinMessage, handlePin, handleMute, handleDeleteChat,
  } = useChatActions({
    currentUser, selectedChat, addMessage, setMessages, loadChats,
    sendTyping,
    setErrorToast: (msg) => { if (msg !== null) setErrorToast(msg) },
  })

  // Load E2E keys asynchronously
  useEffect(() => {
    loadE2EKeys().then(setE2eKeys).catch(() => setE2eKeys(null))
  }, [])

  useEffect(() => {
    loadChats()
    loadContacts()
    loadInvites()
    initNotifications()
  }, [loadChats, loadContacts, loadInvites])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    const p2pKeys = localStorage.getItem("p2p_keys")
    if (p2pKeys) {
      initP2PBridge()
    }
  }, [])

  useEffect(() => {
    const unsub = onP2PBridgeEvent((event) => {
      if (event.type === "peer_connected" && event.data?.user_id) {
        setP2pConnected((prev) => ({ ...prev, [event.data.user_id]: true }))
        sendP2POnlineStatus(event.data.user_id, true)
        // TOFU: verify P2P peer's key
        const chat = useChatStore.getState().selectedChat
        if (chat && !chat.is_group && chat.participants.length === 2) {
          const peer = chat.participants.find(p => p.id === event.data.user_id)
          if (peer?.public_key) {
            const status = checkKeyStatus(peer.id, peer.public_key)
            if (status === "changed") {
              setKeyWarning(t("chat.keyChanged", { name: peer.username || peer.first_name }))
            }
          }
        }
      } else if (event.type === "peer_disconnected" && event.data?.user_id) {
        setP2pConnected((prev) => {
          const next = { ...prev }
          delete next[event.data.user_id]
          return next
        })
      }
    })
    return unsub
  }, [setP2pConnected])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
    if (isNearBottom) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, messagesContainerRef, messagesEndRef])

  useEffect(() => {
    if (!scrollToMessageId) return
    const el = document.getElementById(`msg-${scrollToMessageId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.classList.add("msg-highlighted")
      setTimeout(() => el.classList.remove("msg-highlighted"), 2000)
      setScrollToMessageId(null)
    }
  }, [scrollToMessageId, messages])

  useEffect(() => {
    const unsub = onP2PBridgeEvent((event) => {
      if (event.type === "message_received" && event.data && selectedChat) {
        const d = event.data
        const senderId = d.sender_id
        if (selectedChat.participants.some(p => p.id === senderId)) {
          const msgId = d.message_id || `p2p_${Date.now()}`
          setMessages((prev) => {
            if (prev.some(m => m.id === msgId)) return prev
            const peer = selectedChat.participants.find(p => p.id === senderId)
            // Resolve reply_to preview from local messages
            let replyTo = undefined
            if (d.reply_to_id) {
              const quoted = prev.find(m => m.id === d.reply_to_id)
              if (quoted) {
                replyTo = { id: quoted.id, content: quoted.content, user_id: quoted.user_id, user: quoted.user || currentUser }
              }
            }
            return [...prev, {
              id: msgId, chat_id: selectedChat.id, user_id: senderId,
              content: d.content || "[encrypted]", message_type: "text",
              created_at: new Date().toISOString(),
              user: peer || currentUser, username: peer?.username || "",
              first_name: peer?.first_name || "", is_read: true, is_deleted: false,
              reactions: {},
              reply_to_id: d.reply_to_id || undefined,
              reply_to: replyTo,
            }]
          })
        }
      } else if (event.type === "group_received" && event.data && selectedChat) {
        const d = event.data
        const senderId = d.sender_id
        if (selectedChat.is_group && selectedChat.participants.some(p => p.id === senderId)) {
          const msgId = d.msg_id || `p2p_group_${Date.now()}`
          setMessages((prev) => {
            if (prev.some(m => m.id === msgId)) return prev
            const peer = selectedChat.participants.find(p => p.id === senderId)
            return [...prev, {
              id: msgId, chat_id: selectedChat.id, user_id: senderId,
              content: d.content || "[encrypted]", message_type: "text",
              created_at: new Date().toISOString(),
              user: peer || currentUser, username: peer?.username || "",
              first_name: peer?.first_name || "", is_read: true, is_deleted: false,
              reactions: {},
            }]
          })
        }
      } else if (event.type === "file_received" && event.data && selectedChat) {
        const d = event.data
        const senderId = d.sender_id
        if (selectedChat.participants.some(p => p.id === senderId)) {
          const msgId = `p2p_file_${d.file_id}`
          const blob = new Blob([d.file_data], { type: d.mime_type })
          const blobUrl = URL.createObjectURL(blob)
          setMessages((prev) => {
            const existing = prev.find(m => m.id === msgId)
            if (existing) {
              return prev.map(m => m.id === msgId ? { ...m, file_id: d.file_id, content: blobUrl } : m)
            }
            const peer = selectedChat.participants.find(p => p.id === senderId)
            return [...prev, {
              id: msgId, chat_id: selectedChat.id, user_id: senderId,
              content: blobUrl, message_type: "file",
              file_id: d.file_id,
              created_at: new Date().toISOString(),
              user: peer || currentUser, username: peer?.username || "",
              first_name: peer?.first_name || "", is_read: true, is_deleted: false,
              reactions: {},
            }]
          })
        }
      } else if (event.type === "reaction_received" && event.data && selectedChat) {
        const d = event.data
        const senderId = d.sender_id
        if (selectedChat.participants.some(p => p.id === senderId)) {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== d.msg_id) return m
            const msgReactions = { ...(m.reactions || {}) }
            const reactors = [...(msgReactions[d.emoji] || [])]
            if (d.add) { if (!reactors.includes(senderId)) reactors.push(senderId) }
            else { const idx = reactors.indexOf(senderId); if (idx >= 0) reactors.splice(idx, 1) }
            if (reactors.length > 0) msgReactions[d.emoji] = reactors
            else delete msgReactions[d.emoji]
            return { ...m, reactions: msgReactions }
          }))
        }
      } else if (event.type === "typing_received" && event.data) {
        const d = event.data
        const chatId = d.chat_id
        if (chatId) {
          useChatStore.getState().setTypingUsers((prev) => ({
            ...prev,
            [chatId]: { ...prev[chatId], [d.sender_id]: d.is_typing }
          }))
          if (d.is_typing) {
            setTimeout(() => {
              useChatStore.getState().setTypingUsers((prev) => {
                const chatTyping = { ...prev[chatId] }
                delete chatTyping[d.sender_id]
                return { ...prev, [chatId]: chatTyping }
              })
            }, 4000)
          }
        }
      } else if (event.type === "online_status_received" && event.data) {
        const d = event.data
        setOnlineUsers((prev) => ({ ...prev, [d.sender_id]: d.is_online }))
      } else if (event.type === "message_edit_received" && event.data && selectedChat) {
        const d = event.data
        if (selectedChat.participants.some(p => p.id === d.sender_id)) {
          setMessages((prev) => prev.map((m) => m.id === d.msg_id ? { ...m, content: d.new_content } : m))
        }
      } else if (event.type === "message_delete_received" && event.data && selectedChat) {
        const d = event.data
        if (selectedChat.participants.some(p => p.id === d.sender_id)) {
          if (d.delete_for_all) {
            setMessages((prev) => prev.map((m) => m.id === d.msg_id ? { ...m, is_deleted: true, deleted_for_all: true } : m))
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== d.msg_id))
          }
        }
      }
    })
    return unsub
  }, [selectedChat, setMessages, currentUser, t])

  useEffect(() => {
    if (selectedChat) chatIdRef.current = selectedChat.id
  }, [selectedChat, chatIdRef])

  // P2P notification listener вЂ” shows desktop notifications for messages in other chats
  useEffect(() => {
    const unsub = onP2PBridgeEvent((event) => {
      if (event.type === "message_received" && event.data) {
        const d = event.data
        const currentChatId = useChatStore.getState().selectedChat?.id
        const chats = useChatStore.getState().chats
        // Find which chat this sender belongs to
        const senderChat = chats.find(c =>
          c.participants.some(p => p.id === d.sender_id) && c.id !== currentChatId
        )
        if (senderChat) {
          const sender = senderChat.participants.find(p => p.id === d.sender_id)
          const name = sender?.username || sender?.first_name || "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ"
          const preview = (d.content || "").slice(0, 50)
          showNotification(name, preview)
        }
      }
    })
    return unsub
  }, [])

  // Call event listener
  useEffect(() => {
    const unsub = onCallEvent((event) => {
      if (event.type === "call_incoming" || event.type === "call_connected") {
        setActiveCall(getActiveCall())
      } else if (event.type === "call_ended" || event.type === "call_failed") {
        setActiveCall(null)
        setCallMuted(false)
        setCallVideoOff(false)
      }
    })
    return unsub
  }, [])

  const handleSelectChat = useCallback((chatId: string) => {
    const { chats, selectedChat, input } = useChatStore.getState()
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return

    const idx = filteredChats.findIndex((c) => c.id === chatId)
    if (idx >= 0) setChatIndex(idx)

    setKeyWarning(null)
    if (chat.participants.length === 2) {
      const peer = chat.participants.find((p) => p.id !== currentUser.id)
      if (peer?.public_key) {
        const status = checkKeyStatus(peer.id, peer.public_key)
        if (status === "changed") setKeyWarning(t("chat.keyChanged", { name: peer.username || peer.first_name }))
        else if (status === "new") setKeyWarning(t("chat.keyNew", { name: peer.username || peer.first_name }))
      }
    }

    if (selectedChat) saveDraft(selectedChat.id, input)
    setSelectedChat(chat)
    setMessages([])
    setReplyTo(null)
    setShowEmoji(false)
    setShowStickers(false)
    setHasMore(true)
    setInput(getDraft(chatId))
    api.markAsRead(chatId).catch(() => {})
    loadChats()
    loadMessages(chat)

    api.getPinnedMessages(chatId)
      .then((pins) => setPinnedMessage(pins.length > 0 ? pins[0].message : null))
      .catch(() => setPinnedMessage(null))

    api.getPolls(chatId)
      .then(setPolls)
      .catch(() => setPolls([]))

    if (!chat.is_group && chat.participants.length === 2) {
      const peer = chat.participants.find(p => p.id !== currentUser.id)
      if (peer) registerPeer(peer.id, peer.public_key || "")
    }
  }, [currentUser, loadChats, loadMessages, setPinnedMessage, setMessages, setReplyTo, setHasMore, setSelectedChat, setShowEmoji, setShowStickers, setInput, t, filteredChats])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      if (container.scrollTop < 80 && !loadingMore && hasMore && selectedChat) loadMore(selectedChat)
    }
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [loadingMore, hasMore, selectedChat, loadMore, messagesContainerRef])

  useEffect(() => {
    const handleUnload = () => {
      const { selectedChat, input } = useChatStore.getState()
      if (selectedChat && input) saveDraft(selectedChat.id, input)
    }
    window.addEventListener("beforeunload", handleUnload)
    return () => window.removeEventListener("beforeunload", handleUnload)
  }, [])

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    const selectedChat = useChatStore.getState().selectedChat
    if (selectedChat) {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      sendTyping(true)
      typingTimerRef.current = setTimeout(() => sendTyping(false), 3000)
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      draftTimerRef.current = setTimeout(() => saveDraft(selectedChat.id, value), 500)
    }
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
  }, [sendTyping, setInput, typingTimerRef])

  const insertMention = useCallback((username: string) => {
    const input = useChatStore.getState().input
    const atPos = input.lastIndexOf("@", mentionIndex >= 0 ? mentionIndex : input.length)
    if (atPos >= 0) {
      setInput(input.slice(0, atPos) + "@" + username + " " + input.slice(atPos + mentionQuery.length + 1))
    }
    setMentionQuery("")
    setMentionIndex(-1)
    inputRef.current?.focus()
  }, [mentionQuery, mentionIndex, setInput])

  const chatListRef = useRef<HTMLDivElement>(null)
  const [chatIndex, setChatIndex] = useState(0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery) {
      const selectedChat = useChatStore.getState().selectedChat
      const candidates = selectedChat?.participants.filter(
        (p) => p.id !== currentUser.id && p.username.toLowerCase().includes(mentionQuery.toLowerCase())
      ) || []
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex((prev) => Math.min(prev + 1, candidates.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if ((e.key === "Enter" || e.key === "Tab") && candidates.length > 0) {
        e.preventDefault()
        insertMention(candidates[Math.max(0, mentionIndex)].username)
        return
      }
      if (e.key === "Escape") { setMentionQuery(""); setMentionIndex(-1); return }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = useCallback(async () => {
    const input = useChatStore.getState().input
    const text = input.trim()
    const chat = useChatStore.getState().selectedChat
    if (!text || !chat) return
    await handleSendAction(input)
    setInput("")
    setReplyTo(null)
    setMentionQuery("")
    setMentionIndex(-1)
    if (chat) removeDraft(chat.id)
  }, [handleSendAction, setInput, setReplyTo])

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
      setToast({ id: "export", title: t("chat.export"), body: t("chat.exportCompleted") })
    } catch { setErrorToast(t("errors.exportFailed")) }
  }, [selectedChat, setToast, setErrorToast, t])

  useKeyboardShortcuts({
    onSearch: () => setShowGlobalSearch(true),
    onNewChat: () => setShowAddContact(true),
    onExport: handleExportChat,
    onFindInChat: () => { setSearchQuery(""); setScrollToMessageId(null) },
    onJumpToLatest: () => { if (selectedChat) { setTab("chats") } },
    onPrevChat: () => {
      const list = filteredChats
      if (list.length === 0) return
      const idx = Math.max(0, chatIndex - 1)
      setChatIndex(idx)
      setSelectedChat(list[idx])
    },
    onNextChat: () => {
      const list = filteredChats
      if (list.length === 0) return
      const idx = Math.min(list.length - 1, chatIndex + 1)
      setChatIndex(idx)
      setSelectedChat(list[idx])
    },
    onEscape: () => {
      setShowEmoji(false); setShowStickers(false); setShowAddContact(false); setShowCreateChat(false)
      setShowForward(null); setShowGlobalSearch(false); setShowGroupSettings(false); setProfileUser(null)
    },
  })

  const handleRemoveContact = useCallback(async (contactId: string) => {
    try { await api.removeContact(contactId); loadContacts() } catch { setErrorToast(t("errors.removeContact")) }
  }, [loadContacts, setErrorToast, t])

  const handleStartChat = useCallback(async (userId: string) => {
    try {
      const chat = await api.createChat("", [userId], false)
      loadChats(); setSelectedChat(chat); setTab("chats"); setMessages([])
    } catch { setErrorToast(t("errors.createChat")) }
  }, [loadChats, setSelectedChat, setTab, setMessages, setErrorToast, t])

  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    try { await api.acceptGroupInvite(inviteId); loadInvites(); loadChats() } catch { setErrorToast(t("errors.acceptInvite")) }
  }, [loadChats, loadInvites, setErrorToast, t])

  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    try { await api.declineGroupInvite(inviteId); loadInvites() } catch { setErrorToast(t("errors.declineInvite")) }
  }, [loadInvites, setErrorToast, t])

  const handleAddContact = useCallback(async (userId: string) => {
    try { await api.addContact(userId); setShowAddContact(false); loadContacts() } catch { setErrorToast(t("errors.addContact")) }
  }, [loadContacts, setErrorToast, setShowAddContact, t])

  const handleCreateChat = useCallback(async (participantIds: string[], name: string | null, isSecret?: boolean, secretTtl?: number) => {
    try {
      const isGroup = participantIds.length > 1
      const chat = await api.createChat(name || "", participantIds, isGroup, isSecret || false, secretTtl || 0)
      setShowCreateChat(false); loadChats(); setSelectedChat(chat); setTab("chats"); setMessages([])
    } catch { setErrorToast(t("errors.createChat")) }
  }, [loadChats, setMessages, setErrorToast, setShowCreateChat, setSelectedChat, setTab, t])

  const handleEmojiSelect = useCallback((emoji: string) => setInput((prev) => prev + emoji), [setInput])

  const handleCreatePoll = useCallback(async (data: { question: string; options: { text: string }[]; is_anonymous?: boolean; allow_multiple?: boolean }) => {
    if (!selectedChat) return
    try {
      await api.createPoll(selectedChat.id, data)
      setShowCreatePoll(false)
      const updated = await api.getPolls(selectedChat.id)
      setPolls(updated)
    } catch { setErrorToast(t("errors.pollCreateFailed")) }
  }, [selectedChat, setErrorToast, t])

  const handleBookmark = useCallback(async (messageId: string) => {
    if (!selectedChat) return
    const isBookmarked = bookmarkedIds.has(messageId)
    try {
      if (isBookmarked) { await api.removeBookmark(messageId); setBookmarkedIds((prev) => { const n = new Set(prev); n.delete(messageId); return n }) }
      else { await api.addBookmark(messageId, selectedChat.id); setBookmarkedIds((prev) => new Set(prev).add(messageId)) }
    } catch { setErrorToast(isBookmarked ? t("errors.removeBookmark") : t("errors.addBookmark")) }
  }, [selectedChat, bookmarkedIds, setErrorToast, setBookmarkedIds, t])

  const handleSearchMessages = useCallback(async () => {
    if (!searchQuery.trim() || !selectedChat) return
    setSearching(true)
    try { setSearchResults((await api.searchMessages(selectedChat.id, searchQuery)) || []) }
    catch { console.error("Search failed") }
    setSearching(false)
  }, [searchQuery, selectedChat])

  const handleFilePick = useCallback(() => fileInputRef.current?.click(), [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0 || !selectedChat) return
    const peer = !selectedChat.is_group ? selectedChat.participants.find(p => p.id !== currentUser.id) : undefined
    const p2pAvailable = !!peer && isPeerConnected(peer.id)
    setUploading(true); setUploadProgress(0)
    let completed = 0
    for (const file of files) {
      try {
        const fileType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file"
        // P2P-first: send file directly to peer, no relay involved
        if (p2pAvailable && peer) {
          const fileData = new Uint8Array(await file.arrayBuffer())
          const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2)}`
          const sent = await sendP2PFileMessage(peer.id, fileId, file.name, fileData, file.type || "application/octet-stream")
          if (sent) {
            const blobUrl = URL.createObjectURL(file)
            addMessage({
              id: `p2p_file_${fileId}`, chat_id: selectedChat.id, user_id: currentUser.id,
              content: blobUrl, message_type: fileType, file_id: fileId,
              created_at: new Date().toISOString(), user: currentUser, is_read: true,
              is_deleted: false, reactions: {},
            })
            completed++
            continue
          }
        }
        // Fallback: relay (peer offline or P2P failed)
        const uploaded = await api.uploadFile(file, fileType, (p) => setUploadProgress(((completed + p) / files.length) * 100))
        const msg = await api.sendMessage(selectedChat.id, file.name, fileType, uploaded.id)
        addMessage(msg); completed++
      } catch { setErrorToast(t("errors.fileUpload", { name: file.name })) }
    }
    loadChats(); setUploading(false); setUploadProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [selectedChat, loadChats, addMessage, setErrorToast, setUploading, setUploadProgress, t])

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
          // P2P-first for voice
          const peer = !selectedChat.is_group ? selectedChat.participants.find(p => p.id !== currentUser.id) : undefined
          const p2pAvailable = !!peer && isPeerConnected(peer.id)
          if (p2pAvailable && peer) {
            const fileData = new Uint8Array(await file.arrayBuffer())
            const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2)}`
            const sent = await sendP2PFileMessage(peer.id, fileId, file.name, fileData, file.type || "audio/webm")
            if (sent) {
              const blobUrl = URL.createObjectURL(blob)
              addMessage({
                id: `p2p_file_${fileId}`, chat_id: selectedChat.id, user_id: currentUser.id,
                content: blobUrl, message_type: "voice", file_id: fileId,
                created_at: new Date().toISOString(), user: currentUser, is_read: true,
                is_deleted: false, reactions: {},
              })
              loadChats()
            }
          } else {
            const uploaded = await api.uploadFile(file, "voice")
            const msg = await api.sendMessage(selectedChat.id, t("chat.voiceMessage"), "voice", uploaded.id)
            addMessage(msg); loadChats()
          }
        } catch { console.error("Voice failed") }
        setUploading(false)
      }
      const MAX_DURATION = 300
      mr.start(); setMediaRecorder(mr); setRecording(true); setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => {
          if (t + 1 >= MAX_DURATION) { mr.stop(); return MAX_DURATION }
          return t + 1
        })
      }, 1000)
    } catch { console.error("Microphone denied") }
  }, [selectedChat, loadChats, addMessage, setUploading, t])

  const stopRecording = useCallback(() => { mediaRecorder?.stop(); setMediaRecorder(null); setRecording(false) }, [mediaRecorder])

  const handleAcceptCall = useCallback(() => {
    if (!incomingCall) return
    wsRef.current?.send(JSON.stringify({ event: "call_accept", data: { call_id: incomingCall.callId } }))
    setIncomingCall(null)
    navigate(`/call/${incomingCall.callerId}/${incomingCall.callType}?call_id=${incomingCall.callId}`)
  }, [incomingCall, navigate, setIncomingCall, wsRef])

  const handleRejectCall = useCallback(() => {
    if (!incomingCall) return
    wsRef.current?.send(JSON.stringify({ event: "call_reject", data: { call_id: incomingCall.callId } }))
    setIncomingCall(null)
  }, [incomingCall, setIncomingCall, wsRef])

  const handleViewProfile = useCallback((user: UserResponse) => setProfileUser(user), [setProfileUser])

  const handleProfile = useCallback(() => navigate("/profile"), [navigate])
  const handleLogout = useCallback(() => { api.clearToken(); clearPin(); navigate("/login", { replace: true }) }, [navigate])
  const handleSettings = useCallback(() => navigate("/settings"), [navigate])
  const handleLegal = useCallback(() => navigate("/legal"), [navigate])
  const handleP2P = useCallback(() => navigate("/p2p"), [navigate])

  const mentionCandidates = mentionQuery && selectedChat
    ? selectedChat.participants.filter((p) => p.id !== currentUser.id && p.username.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  const unreadCount = chats.reduce((sum, c) => sum + ((c as Record<string, unknown>).unread_count as number || 0), 0)

  const selectedChatName = selectedChat
    ? selectedChat.is_group ? (selectedChat.name || t("chat.chats")) : selectedChat.participants.find((p) => p.id !== currentUser.id)?.username || t("chat.chats")
    : ""
  const selectedChatAvatar = selectedChatName[0]?.toUpperCase() || "?"
  const isSelectedGroup = selectedChat?.is_group || false

  const currentTyping = selectedChat ? typingUsers[selectedChat.id] : undefined
  const typingNames = currentTyping
    ? Object.entries(currentTyping).filter(([, v]) => v).map(([uid]) => {
        const p = selectedChat?.participants.find((pp) => pp.id === uid)
        return p?.username || t("chat.replySender")
      })
    : []

  return (
    <div className="chat-page">
      <OfflineBanner isOnline={offlineQueueIsOnline} pendingCount={pendingCount} />
      <TopBar
        username={currentUser.username}
        avatarChar={currentUser.username[0]?.toUpperCase() || "?"}
        avatarUrl={avatarUrl(currentUser.avatar_path)}
        onProfile={handleProfile}
        onLogout={handleLogout}
        onSwitchAccount={handleLogout}
        onSettings={handleSettings}
        onLegal={handleLegal}
        onP2P={handleP2P}
      />

      <NotificationToast toast={toast} onClose={() => setToast(null)} onClick={(chatId) => { setToast(null); if (chatId) handleSelectChat(chatId) }} />

      {errorToast && (
        <div className="error-toast" onClick={() => setErrorToast(null)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{errorToast}</span>
        </div>
      )}

      {!isOnline && (
        <div className="offline-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.56 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>{t("common.serverUnavailable")}</span>
        </div>
      )}

      {incomingCall && (
        <div className="incoming-call-banner">
          <div className="incoming-call-info">
            <span className="incoming-call-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </span>
            <div>
              <span className="incoming-call-name">{incomingCall.callerName}</span>
              <span className="incoming-call-type">{incomingCall.callType === "video" ? t("call.videoCall") : t("call.audioCall")}</span>
            </div>
          </div>
          <div className="incoming-call-actions">
            <button className="incoming-call-btn reject" onClick={handleRejectCall} title={t("call.reject")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button className="incoming-call-btn accept" onClick={handleAcceptCall} title={t("call.accept")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="chat-body">
        {/* Sidebar — hidden on mobile when chat selected */}
        {!(isMobile && selectedChat) && (
        <ChatSidebar
          tab={tab} setTab={setTab} search={search} setSearch={setSearch}
          chats={chats} filteredChats={filteredChats} contacts={contacts} invites={invites}
          currentUser={currentUser} chatListRef={chatListRef}
          scrollToMessageId={scrollToMessageId} setScrollToMessageId={setScrollToMessageId}
          setSelectedChat={setSelectedChat} setShowCreateChat={setShowCreateChat}
          setShowAddContact={setShowAddContact}
          handleSelectChat={handleSelectChat} handlePin={handlePin}
          handleMute={handleMute} handleDeleteChat={handleDeleteChat}
          handleRemoveContact={handleRemoveContact} handleStartChat={handleStartChat}
          handleAcceptInvite={handleAcceptInvite} handleDeclineInvite={handleDeclineInvite}
        />
        )}

        {/* Main */}
        <div className="chat-main" role="main" id="main-content">
          {!selectedChat ? (
            <div className="chat-placeholder" role="status">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2AABEE" strokeWidth="1.5" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              <h3>NurChat</h3>
              <p>{t("chat.placeholder")}</p>
            </div>
          ) : (
            <div className="chat-window">
              {/* Header */}
              <div className="chat-header">
                {isMobile && (
                  <button className="ch-btn mobile-back" onClick={() => setSelectedChat(null)} aria-label={t("common.back", "Назад")}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                )}
                <div className="ch-avatar clickable"
                  onClick={() => { if (!isSelectedGroup) { const peer = selectedChat.participants.find(p => p.id !== currentUser.id); if (peer) handleViewProfile(peer) } }}>
                  {selectedChatAvatar}
                </div>
                <div className="ch-info">
                  <span className="ch-name" style={!isSelectedGroup ? { cursor: "pointer" } : undefined}
                    onClick={() => { if (!isSelectedGroup) { const peer = selectedChat.participants.find(p => p.id !== currentUser.id); if (peer) handleViewProfile(peer) } }}>
                    {selectedChatName}
                  </span>
                  <span className="ch-status" role="status" aria-live="polite">
                    {typingNames.length > 0
                      ? `${typingNames.length > 1 ? t("chat.typingPlural") : t("chat.typingSingular")} ${typingNames.join(", ")}...`
                      : isSelectedGroup
                        ? `${selectedChat.participants.length} ${t("chat.participants")}`
                        : (() => {
                            const peer = selectedChat.participants.find((p) => p.id !== currentUser.id)
                            const peerId = peer?.id || ""
                            const isOnline = onlineUsers[peerId]
                            const isP2P = !!p2pConnected[peerId]
                            if (isOnline && isP2P) return t("common.p2pOnline")
                            if (isOnline) return `${t("common.online")} · ${t("common.viaRelay")}`
                            return t("common.offline")
                          })()}
                  </span>
                </div>
                <div className="ch-actions">
                  <button className="ch-btn" title={t("chat.searchInChat")} aria-label={t("chat.searchInChat")} onClick={() => setSearchQuery("")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  <button className="ch-btn" title={t("common.globalSearch")} aria-label={t("common.globalSearch")} onClick={() => setShowGlobalSearch(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  <button className="ch-btn" title={t("chat.invite")} aria-label={t("chat.invite")} onClick={() => setShowInviteModal(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  </button>
                  {isSelectedGroup && (
                    <>
                      <button className="ch-btn" title={t("calls.groupCall", "Групповой звонок")} aria-label={t("calls.groupCall", "Групповой звонок")} onClick={() => setShowGroupCall(true)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      </button>
                      <button className="ch-btn" title={t("common.groupSettings")} aria-label={t("common.groupSettings")} onClick={() => setShowGroupSettings(true)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                      </button>
                    </>
                  )}
                  {!isSelectedGroup && (
                    <>
                      <button className="ch-btn" title={t("call.audioCall")} aria-label={t("call.audioCall")} onClick={() => {
                        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                        if (peer && isPeerConnected(peer.id)) {
                          import("../services/callService").then(({ startCall }) =>
                            startCall(peer.id, peer.public_key || "", false)).catch(() => navigate(`/call/${peer.id}/audio`))
                        } else if (peer) {
                          navigate(`/call/${peer.id}/audio`)
                        }
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      </button>
                      <button className="ch-btn" title={t("call.videoCall")} aria-label={t("call.videoCall")} onClick={() => {
                        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                        if (peer && isPeerConnected(peer.id)) {
                          import("../services/callService").then(({ startCall }) =>
                            startCall(peer.id, peer.public_key || "", true)).catch(() => navigate(`/call/${peer.id}/video`))
                        } else if (peer) {
                          navigate(`/call/${peer.id}/video`)
                        }
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                      </button>
                    </>
                  )}
                  <button className="ch-btn" title={t("chat.export")} aria-label={t("chat.export")} onClick={handleExportChat}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  </button>
                </div>
              </div>

              {keyWarning && (
                <div style={{ background: "rgba(255,152,0,0.1)", borderBottom: "1px solid rgba(255,152,0,0.3)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#ff9800" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{keyWarning}</span>
                  <button onClick={() => setKeyWarning(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#ff9800", cursor: "pointer", padding: 4 }}>Г—</button>
                </div>
              )}

              {selectedChat?.is_secret && (
                <div className="secret-chat-banner">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <span>{t("chat.secretChat", { seconds: selectedChat.disappears_after_seconds })}</span>
                </div>
              )}

              {/* Messages */}
              <div className="chat-messages" ref={messagesContainerRef}>
                {pinnedMessage && (
                  <div className="pinned-banner" onClick={() => setShowPinnedModal(true)}>
                    <span className="pinned-banner-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L12 22" /><path d="M17 7L12 2L7 7" /></svg>
                    </span>
                    <div className="pinned-banner-text">
                      <div className="pinned-banner-title">{t("chat.pinnedMessage")}</div>
                      <div className="pinned-banner-preview">{pinnedMessage.content || t("chat.media")}</div>
                    </div>
                    <button className="pinned-banner-close" onClick={(e) => { e.stopPropagation(); setPinnedMessage(null) }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}

                {searchQuery && (
                  <div className="search-bar" role="search" aria-label={t("chat.searchMessages")}>
                    <input type="text" placeholder={t("chat.searchMessages")} value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearchMessages()} autoFocus aria-label={t("chat.searchMessages")} />
                    <button className="search-btn" onClick={handleSearchMessages} disabled={searching} aria-label={t("chat.find")}>{searching ? "..." : t("chat.find")}</button>
                    <button className="search-close" onClick={() => { setSearchQuery(""); setSearchResults([]) }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="search-results">
                    {searchResults.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} currentUser={currentUser} isMyMessage={msg.user_id === currentUser.id}
                        reactions={msg.reactions} onReply={(id) => handleReply(id, messages)} onDelete={handleDeleteMessage}
                        onForward={(id) => setShowForward(id)} onReaction={handleReaction} onEdit={handleEditMessage}
                        onViewProfile={handleViewProfile} onBookmark={handleBookmark} isBookmarked={bookmarkedIds.has(msg.id)}
                        highlightQuery={searchQuery} onShowInfo={setShowMessageInfo} />
                    ))}
                  </div>
                )}

                {searchQuery && searchResults.length === 0 && !searching && <p className="search-no-results">{t("chat.nothingFound")}</p>}

                {!searchQuery && loadingMore && (
                  <div className="messages-loading"><div className="messages-spinner" /><span>{t("chat.loading")}</span></div>
                )}

                {!searchQuery && initialLoading && messages.length === 0 && (
                  <MessageListSkeleton />
                )}

                {!searchQuery && messages.length > 0 && (
                  <VirtualizedMessageList
                    messages={messages}
                    currentUser={currentUser}
                    reactions={messages.reduce((acc, m) => { if (m.reactions) acc[m.id] = m.reactions; return acc }, {} as Record<string, Record<string, string[]>>)}
                    bookmarkedIds={bookmarkedIds}
                    onReply={(id) => handleReply(id, messages)}
                    onDelete={handleDeleteMessage}
                    onForward={(id) => setShowForward(id)}
                    onReaction={handleReaction}
                    onEdit={handleEditMessage}
                    onViewProfile={handleViewProfile}
                    onBookmark={handleBookmark}
                    onPin={handlePinMessage}
                    onShowInfo={setShowMessageInfo}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>

              {!searchQuery && polls.length > 0 && (
                <div className="chat-polls">
                  {polls.map((poll) => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      currentUserId={currentUser.id}
                      onVote={async () => {
                        if (!selectedChat) return
                        const updated = await api.getPolls(selectedChat.id)
                        setPolls(updated)
                      }}
                    />
                  ))}
                </div>
              )}

              {replyTo && (
                <div className="reply-preview">
                  <div className="reply-border">
                    <span className="reply-sender">{replyTo.user?.username || t("chat.replySender")}</span>
                    <span className="reply-text">{replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? "..." : ""}</span>
                  </div>
                  <button className="reply-close" onClick={() => setReplyTo(null)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}

              {(() => {
                const urlMatch = input.match(/https?:\/\/[^\s]+/)
                if (urlMatch && !input.includes("\n")) return <div style={{ padding: "0 12px" }}><LinkPreview url={urlMatch[0]} /></div>
                return null
              })()}

              <div className="chat-input-area" style={{ position: "relative" }} role="form" aria-label={t("chat.messagePlaceholder")}>
                {mentionCandidates.length > 0 && (
                  <div className="mention-dropdown">
                    {mentionCandidates.map((u) => (
                      <div key={u.id} className="mention-item" onClick={() => insertMention(u.username)}>
                        <span className="mention-at">@</span><span>{u.username}</span>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={fileInputRef} type="file" hidden multiple onChange={handleFileChange} />
                <button className="input-btn" title={t("common.emoji")} onClick={() => setShowEmoji(!showEmoji)} disabled={recording || uploading} aria-expanded={showEmoji}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button className="input-btn" title={t("common.sticker")} onClick={() => setShowStickers(!showStickers)} disabled={recording || uploading} aria-expanded={showStickers}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /><path d="M9 15c1 1 5 1 6 0" /></svg>
                </button>
                <button className="input-btn" title={t("common.file")} disabled={recording || uploading} onClick={handleFilePick}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                </button>
                <button className="input-btn" title={t("poll.create")} disabled={recording || uploading || !selectedChat?.is_group} onClick={() => setShowCreatePoll(true)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                </button>

                {uploading ? (
                  <div className="chat-input-uploading">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <span>{t("chat.uploading")}</span>
                      <div style={{ flex: 1, height: 4, background: "var(--input-bg)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${uploadProgress}%`, background: "var(--tg-blue)", borderRadius: 2, transition: "width 0.2s" }} />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--tg-blue)" }}>{uploadProgress}%</span>
                    </div>
                  </div>
                ) : recording ? (
                  <div className="chat-input-recording">
                    <span className="recording-dot" />
                    <span className="recording-time">{String(Math.floor(recordingTime / 60)).padStart(2, "0")}:{String(recordingTime % 60).padStart(2, "0")}</span>
                    <button className="input-btn record-stop" onClick={stopRecording} title={t("chat.stop")}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    </button>
                  </div>
                ) : (
                  <textarea ref={inputRef} className="chat-input" placeholder={t("chat.messagePlaceholder")} rows={1}
                    value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={handleKeyDown} />
                )}

                {!recording && !uploading && (
                  input.trim() ? (
                    <button className="send-btn" onClick={handleSend} aria-label={t("common.send")}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                  ) : (
                    <button className={`input-btn ${recording ? "record-active" : ""}`} title={t("common.voice")} aria-label={t("common.voice")} onClick={startRecording}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    </button>
                  )
                )}
                {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
                {showStickers && <StickerPicker onSelect={(sticker) => { setInput((prev) => prev + sticker); setShowStickers(false); inputRef.current?.focus() }} />}
              </div>

              {activeCall && (
                <CallOverlay activeCall={activeCall} callMuted={callMuted}
                  setCallMuted={setCallMuted} callVideoOff={callVideoOff} setCallVideoOff={setCallVideoOff} />
              )}
              {showGroupCall && selectedChat && (
                <GroupCallOverlay chatId={selectedChat.id} isGroup={!!selectedChat.is_group} onClose={() => setShowGroupCall(false)} />
              )}
            </div>
          )}
        </div>
      </div>

      {isMobile && (
        <BottomTabs
          activeTab={tab}
          onTabChange={(newTab) => {
            setTab(newTab as "chats" | "calls" | "contacts" | "settings")
            if (newTab === "chats") navigate("/chat")
            if (newTab === "settings") navigate("/settings")
            if (newTab === "calls") navigate("/calls")
            if (newTab === "contacts") navigate("/contacts")
          }}
          badges={{
            chats: unreadCount,
          }}
        />
      )}

      {showCreatePoll && (
        <CreatePollModal onCreate={handleCreatePoll} onClose={() => setShowCreatePoll(false)} />
      )}

      <ChatModals
        showAddContact={showAddContact} contacts={contacts} currentUser={currentUser}
        onAddContact={handleAddContact} onCloseAddContact={() => setShowAddContact(false)}
        showCreateChat={showCreateChat} onCreateChat={handleCreateChat}
        onCloseCreateChat={() => setShowCreateChat(false)}
        showForward={showForward} selectedChatId={selectedChat?.id}
        onForward={handleForward} onCloseForward={() => setShowForward(null)}
        profileUser={profileUser} onCloseProfile={() => setProfileUser(null)}
        showGroupSettings={showGroupSettings} selectedChat={selectedChat}
        onCloseGroupSettings={() => setShowGroupSettings(false)} onGroupUpdated={loadChats}
        showGlobalSearch={showGlobalSearch} chats={chats}
        onSelectGlobalSearch={(chatId, messageId) => {
          const chat = chats.find(c => c.id === chatId)
          if (chat) { setSelectedChat(chat); setTab("chats") }
          if (messageId) setScrollToMessageId(messageId)
          setShowGlobalSearch(false)
        }}
        onCloseGlobalSearch={() => setShowGlobalSearch(false)}
        showMessageInfo={showMessageInfo} onCloseMessageInfo={() => setShowMessageInfo(null)}
        showInviteModal={showInviteModal} onCloseInviteModal={() => setShowInviteModal(false)}
        showPinnedModal={showPinnedModal} onClosePinnedModal={() => setShowPinnedModal(false)}
        onPinnedMessageClick={(msgId) => {
          const el = document.getElementById(`msg-${msgId}`)
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
        }}
      />
    </div>
  )
}
