import { useState, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { p2pClient } from "../services/p2p"
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts"
import { useChatSocket } from "../hooks/useChatSocket"
import { useChatMessages } from "../hooks/useChatMessages"
import { useChatActions } from "../hooks/useChatActions"
import { useChatTyping } from "../hooks/useChatTyping"
import { loadKeys as loadE2EKeys, type E2EKeys } from "../services/e2e"
import { checkKeyStatus } from "../services/keyVerification"
import { initNotifications } from "../services/notifications"
import { clearPin } from "../services/pinLock"
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
import LinkPreview from "../components/LinkPreview"
import MessageInfoModal from "../components/MessageInfoModal"
import type { UserResponse, MessageResponse } from "../types"

import { getDraft, saveDraft, removeDraft } from "../utils/drafts"

export default function ChatPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
  const [e2eKeys] = useState<E2EKeys | null>(loadE2EKeys)
  const [keyWarning, setKeyWarning] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<MessageResponse[]>([])
  const [searching, setSearching] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    messages, setMessages, loadingMore, hasMore, containerRef: messagesContainerRef, endRef: messagesEndRef,
    loadMessages, loadMore, addMessage, updateMessage, setHasMore,
  } = useChatMessages({ currentUser, e2eKeys })

  const socketTypingCb = useCallback((fn: (prev: Record<string, Record<string, boolean>>) => Record<string, Record<string, boolean>>) => {
    setTypingUsers(fn)
  }, [])

  const { wsRef, chatIdRef } = useChatSocket({
    currentUser, selectedChat,
    onMessage: useCallback((data: any) => {
      if (data._update) { updateMessage(data.message_id as string, { is_read: true }); return }
      if (data._delete) { updateMessage(data.message_id as string, { is_deleted: true, deleted_for_all: data.delete_for_all as boolean }); return }
      if (data._edit) { updateMessage(data.message_id as string, { content: data.content as string }); return }
      addMessage(data as unknown as MessageResponse)
    }, [addMessage, updateMessage]),
    onChatUpdate: loadChats,
    onToast: setToast,
    onIncomingCall: setIncomingCall,
    onTypingUsers: socketTypingCb,
    onOnlineUsers: setOnlineUsers,
    onReactions: useCallback(() => undefined, []),
    onNavigate: navigate,
  })

  const sendWs = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(data))
  }, [wsRef])

  const { sendTyping: sendTypingRaw, typingTimerRef } = useChatTyping(sendWs)

  const sendTyping = useCallback((isTyping: boolean) => {
    const chatId = useChatStore.getState().selectedChat?.id
    if (!chatId) return
    sendTypingRaw(isTyping, chatId)
  }, [sendTypingRaw])

  const {
    replyTo, setReplyTo, showForward, setShowForward, pinnedMessage, setPinnedMessage,
    handleSend: handleSendAction, handleReply, handleReaction, handleForward, handleEditMessage, handleDeleteMessage,
    handlePinMessage, handlePin, handleMute, handleDeleteChat,
  } = useChatActions({
    currentUser, selectedChat, addMessage, setMessages, loadChats,
    sendTyping,
    setErrorToast: (msg) => { if (msg !== null) setErrorToast(msg) },
  })

  useEffect(() => {
    loadChats()
    loadContacts()
    loadInvites()
    initNotifications()
  }, [loadChats, loadContacts, loadInvites])

  useEffect(() => {
    const token = localStorage.getItem("token")
    const user = JSON.parse(localStorage.getItem("user") || "null")
    const p2pKeys = localStorage.getItem("p2p_keys")
    if (user && token && p2pKeys && !p2pClient.isConnected) {
      p2pClient.connect(user.id, token)
    }
  }, [])

  useEffect(() => {
    const unsub = p2pClient.on((event) => {
      if (event.type === "peer_connected" && event.data?.user_id) {
        setP2pConnected((prev) => ({ ...prev, [event.data.user_id]: true }))
      } else if (event.type === "peer_disconnected" && event.data?.user_id) {
        setP2pConnected((prev) => {
          const next = { ...prev }
          delete next[event.data.user_id]
          return next
        })
      } else if (event.type === "peer_found" && event.data?.user_id) {
        if (selectedChat && !selectedChat.is_group && selectedChat.participants.length === 2) {
          const peer = selectedChat.participants.find(p => p.id === event.data.user_id)
          if (peer) p2pClient.initiateDirectConnection(peer.id)
        }
      }
    })
    return unsub
  }, [selectedChat, setP2pConnected])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
    if (isNearBottom) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, messagesContainerRef, messagesEndRef])

  useEffect(() => {
    const unsub = p2pClient.on((event) => {
      if (event.type === "message_received" && event.data && selectedChat) {
        const d = event.data
        const senderId = d.sender_id || d.user_id
        if (selectedChat.participants.some(p => p.id === senderId)) {
          const msgId = d.message_id || d.id || `p2p_${Date.now()}`
          setMessages((prev) => {
            if (prev.some(m => m.id === msgId)) return prev
            const peer = selectedChat.participants.find(p => p.id === senderId)
            return [...prev, {
              id: msgId, chat_id: selectedChat.id, user_id: senderId,
              content: d.content || "[encrypted]", message_type: "text",
              created_at: d.timestamp || d.created_at || new Date().toISOString(),
              user: peer || currentUser, username: peer?.username || "",
              first_name: peer?.first_name || "", is_read: true, is_deleted: false,
              encrypted_content: d.encrypted_content, reactions: {},
            }]
          })
        }
      }
    })
    return unsub
  }, [selectedChat, setMessages, currentUser])

  useEffect(() => {
    if (selectedChat) chatIdRef.current = selectedChat.id
  }, [selectedChat, chatIdRef])

  const handleSelectChat = useCallback((chatId: string) => {
    const { chats, selectedChat, input } = useChatStore.getState()
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return

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

    if (!chat.is_group && chat.participants.length === 2) {
      const peer = chat.participants.find(p => p.id !== currentUser.id)
      if (peer) p2pClient.initiateDirectConnection(peer.id)
    }
  }, [currentUser, loadChats, loadMessages, setPinnedMessage, setMessages, setReplyTo, setHasMore, setSelectedChat, setShowEmoji, setShowStickers, setInput, t])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); return }
      if (e.key === "Enter" || e.key === "Tab") {
        const selectedChat = useChatStore.getState().selectedChat
        const candidates = selectedChat?.participants.filter(
          (p) => p.id !== currentUser.id && p.username.toLowerCase().includes(mentionQuery.toLowerCase())
        ) || []
        if (candidates.length > 0) { e.preventDefault(); insertMention(candidates[0].username); return }
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

  const handleAddRemoteContact = useCallback(async (address: string) => {
    try {
      const result = await api.createRemoteChat(address)
      const chat = await api.createChat(result.display_name || address, [currentUser.id], false, false, 0)
      setShowAddContact(false)
      loadChats()
      setSelectedChat(chat)
      setTab("chats")
      setMessages([])
    } catch { setErrorToast(t("errors.remoteConnect")) }
  }, [currentUser.id, loadChats, setMessages, setErrorToast, setShowAddContact, setSelectedChat, setTab, t])

  const handleCreateChat = useCallback(async (participantIds: string[], name: string | null, isSecret?: boolean, secretTtl?: number) => {
    try {
      const isGroup = participantIds.length > 1
      const chat = await api.createChat(name || "", participantIds, isGroup, isSecret || false, secretTtl || 0)
      setShowCreateChat(false); loadChats(); setSelectedChat(chat); setTab("chats"); setMessages([])
    } catch { setErrorToast(t("errors.createChat")) }
  }, [loadChats, setMessages, setErrorToast, setShowCreateChat, setSelectedChat, setTab, t])

  const handleEmojiSelect = useCallback((emoji: string) => setInput((prev) => prev + emoji), [setInput])

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
    setUploading(true); setUploadProgress(0)
    let completed = 0
    for (const file of files) {
      try {
        const fileType = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file"
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
          const uploaded = await api.uploadFile(file, "voice")
          const msg = await api.sendMessage(selectedChat.id, t("chat.voiceMessage"), "voice", uploaded.id)
          addMessage(msg); loadChats()
        } catch { console.error("Voice failed") }
        setUploading(false)
      }
      mr.start(); setMediaRecorder(mr); setRecording(true)
      recordingTimerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
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

  const filteredChats = chats.filter((c) => {
    if (!search) return true
    const name = c.is_group ? c.name : c.participants.find((p) => p.id !== currentUser.id)?.username
    return name?.toLowerCase().includes(search.toLowerCase())
  })

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

      {incomingCall && (
        <div className="incoming-call-banner">
          <div className="incoming-call-info">
            <span className="incoming-call-icon">📞</span>
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
        {/* Sidebar */}
        <div className="chat-sidebar">
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${tab === "chats" ? "active" : ""}`} onClick={() => setTab("chats")} title={t("chat.chats")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "contacts" ? "active" : ""}`} onClick={() => setTab("contacts")} title={t("chat.contacts")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "bookmarks" ? "active" : ""}`} onClick={() => setTab("bookmarks")} title={t("chat.bookmarks")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "files" ? "active" : ""}`} onClick={() => setTab("files")} title={t("chat.files")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            </button>
            <button className={`sidebar-tab ${tab === "invites" ? "active" : ""}`} onClick={() => setTab("invites")} title={t("chat.invitations")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
              {invites.length > 0 && <span className="tab-badge">{invites.length}</span>}
            </button>
          </div>
          <div className="sidebar-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input type="text" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sidebar-list-header">
            <span className="sidebar-list-title">
              {tab === "chats" ? t("chat.chats") : tab === "contacts" ? t("chat.contacts") : tab === "files" ? t("chat.files") : t("chat.invitations")}
            </span>
            {(tab === "chats" || tab === "contacts") && (
              <button className="sidebar-add-btn" title={tab === "chats" ? t("chat.newChat") : t("chat.newContact")}
                onClick={() => tab === "chats" ? setShowCreateChat(true) : setShowAddContact(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
          </div>
          <div className="sidebar-list">
            {tab === "chats" && (
              <div className="list-scroll">
                {filteredChats.length === 0 && <p className="list-empty">{t("chat.noChats")}</p>}
                {filteredChats.map((chat) => (
                  <ChatListItem key={chat.id} chat={chat} currentUser={currentUser} onClick={handleSelectChat}
                    onPin={handlePin}                     onMute={(id) => handleMute(id, !!chat.is_muted)} onDelete={(id) => handleDeleteChat(id, setSelectedChat)} />
                ))}
              </div>
            )}
            {tab === "contacts" && (
              <div className="list-scroll">
                {contacts.length === 0 && <p className="list-empty">{t("chat.noContacts")}</p>}
                {contacts.map((contact) => (
                  <ContactListItem key={contact.id} contact={contact} onRemove={handleRemoveContact} onStartChat={handleStartChat} />
                ))}
              </div>
            )}
            {tab === "invites" && (
              <div className="list-scroll">
                {invites.length === 0 && <p className="list-empty">{t("chat.noInvites")}</p>}
                {invites.map((invite) => (
                  <GroupInviteItem key={invite.id} invite={invite} onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />
                ))}
              </div>
            )}
            {tab === "bookmarks" && (
              <div className="list-scroll">
                <BookmarksList onSelectMessage={(chatId) => {
                  const chat = useChatStore.getState().chats.find(c => c.id === chatId)
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
              <p>{t("chat.placeholder")}</p>
            </div>
          ) : (
            <div className="chat-window">
              {/* Header */}
              <div className="chat-header">
                <div className="ch-avatar clickable"
                  onClick={() => { if (!isSelectedGroup) { const peer = selectedChat.participants.find(p => p.id !== currentUser.id); if (peer) handleViewProfile(peer) } }}>
                  {selectedChatAvatar}
                </div>
                <div className="ch-info">
                  <span className="ch-name" style={!isSelectedGroup ? { cursor: "pointer" } : undefined}
                    onClick={() => { if (!isSelectedGroup) { const peer = selectedChat.participants.find(p => p.id !== currentUser.id); if (peer) handleViewProfile(peer) } }}>
                    {selectedChatName}
                  </span>
                  <span className="ch-status">
                    {typingNames.length > 0
                      ? `${typingNames.length > 1 ? t("chat.typingPlural") : t("chat.typingSingular")} ${typingNames.join(", ")}...`
                      : isSelectedGroup
                        ? `${selectedChat.participants.length} ${t("chat.participants")}`
                        : (() => {
                            const peer = selectedChat.participants.find((p) => p.id !== currentUser.id)
                            const peerId = peer?.id || ""
                            const isOnline = onlineUsers[peerId]
                            const isP2P = !!p2pConnected[peerId]
                            const isConnecting = p2pClient.connectingPeers.has(peerId)
                            if (isOnline && isP2P) return t("common.p2pOnline")
                            if (isOnline && isConnecting) return t("common.p2pConnecting")
                            if (isOnline) return t("common.online")
                            return t("common.offline")
                          })()}
                  </span>
                </div>
                <div className="ch-actions">
                  <button className="ch-btn" title={t("chat.searchInChat")} onClick={() => setSearchQuery("")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  <button className="ch-btn" title={t("common.globalSearch")} onClick={() => setShowGlobalSearch(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  </button>
                  {isSelectedGroup && (
                    <button className="ch-btn" title={t("common.groupSettings")} onClick={() => setShowGroupSettings(true)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                    </button>
                  )}
                  {!isSelectedGroup && (
                    <>
                      <button className="ch-btn" title={t("call.audioCall")} onClick={() => {
                        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                        if (peer) navigate(`/call/${peer.id}/audio`)
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      </button>
                      <button className="ch-btn" title={t("call.videoCall")} onClick={() => {
                        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
                        if (peer) navigate(`/call/${peer.id}/video`)
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                      </button>
                    </>
                  )}
                  <button className="ch-btn" title={t("chat.export")} onClick={handleExportChat}>
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
                  <button onClick={() => setKeyWarning(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#ff9800", cursor: "pointer", padding: 4 }}>×</button>
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
                  <div className="pinned-banner" onClick={() => {
                    const el = document.getElementById(`msg-${pinnedMessage.id}`)
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
                  }}>
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
                  <div className="search-bar">
                    <input type="text" placeholder={t("chat.searchMessages")} value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearchMessages()} autoFocus />
                    <button className="search-btn" onClick={handleSearchMessages} disabled={searching}>{searching ? "..." : t("chat.find")}</button>
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

              <div className="chat-input-area" style={{ position: "relative" }}>
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
                <button className="input-btn" title={t("common.emoji")} onClick={() => setShowEmoji(!showEmoji)} disabled={recording || uploading}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button className="input-btn" title={t("common.sticker")} onClick={() => setShowStickers(!showStickers)} disabled={recording || uploading}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /><path d="M9 15c1 1 5 1 6 0" /></svg>
                </button>
                <button className="input-btn" title={t("common.file")} disabled={recording || uploading} onClick={handleFilePick}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
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
                    <button className="send-btn" onClick={handleSend}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                  ) : (
                    <button className={`input-btn ${recording ? "record-active" : ""}`} title={t("common.voice")} onClick={startRecording}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    </button>
                  )
                )}
                {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
                {showStickers && <StickerPicker onSelect={(sticker) => { setInput((prev) => prev + sticker); setShowStickers(false); inputRef.current?.focus() }} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddContact && <AddContactModal existingContactIds={contacts.map((c) => c.contact_user?.id).filter(Boolean)} currentUserId={currentUser.id} onAdd={handleAddContact} onAddRemote={handleAddRemoteContact} onClose={() => setShowAddContact(false)} />}
      {showCreateChat && <CreateChatModal currentUserId={currentUser.id} onCreate={handleCreateChat} onClose={() => setShowCreateChat(false)} />}
      {showForward && <ForwardModal messageId={showForward} sourceChatId={selectedChat?.id} onForward={handleForward} onClose={() => setShowForward(null)} />}
      {profileUser && <UserProfileModal user={profileUser} onClose={() => setProfileUser(null)} />}
      {showGroupSettings && selectedChat && selectedChat.is_group && (
        <GroupSettings chat={selectedChat} currentUser={currentUser} onClose={() => setShowGroupSettings(false)} onUpdated={loadChats} />
      )}
      {showGlobalSearch && (
        <GlobalSearch chats={chats} onSelect={(chatId: string) => {
          const chat = chats.find(c => c.id === chatId)
          if (chat) { setSelectedChat(chat); setTab("chats") }
          setShowGlobalSearch(false)
        }} onClose={() => setShowGlobalSearch(false)} />
      )}
      {showMessageInfo && <MessageInfoModal messageId={showMessageInfo} onClose={() => setShowMessageInfo(null)} />}
    </div>
  )
}
