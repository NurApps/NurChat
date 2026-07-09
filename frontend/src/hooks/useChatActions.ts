import { useState, useCallback } from "react"
import { api } from "../services/api"
import { p2pClient } from "../services/p2p"
import { loadKeys as loadE2EKeys, encryptMessage, isE2EEnabled } from "../services/e2e"
import { getGroupKeyForChat, encryptGroupMessage } from "../services/groupE2E"
import type { ChatResponse, MessageResponse, UserResponse } from "../types"

interface UseChatActionsOptions {
  currentUser: UserResponse
  selectedChat: ChatResponse | null
  addMessage: (msg: MessageResponse) => void
  setMessages: React.Dispatch<React.SetStateAction<MessageResponse[]>>
  loadChats: () => void
  sendTyping: (isTyping: boolean) => void
  setErrorToast: (msg: string | null) => void
}

export function useChatActions({
  currentUser, selectedChat, addMessage, setMessages, loadChats, sendTyping, setErrorToast,
}: UseChatActionsOptions) {
  const [replyTo, setReplyTo] = useState<MessageResponse | null>(null)
  const [showForward, setShowForward] = useState<string | null>(null)
  const [pinnedMessage, setPinnedMessage] = useState<MessageResponse | null>(null)

  const handleSend = useCallback(async (input: string) => {
    const text = input.trim()
    if (!text || !selectedChat) return
    let content = text
    if (replyTo) {
      const sender = replyTo.user?.username || "Пользователь"
      content = `↩️ Ответ ${sender}\n${text}`
    }

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
      } catch (e) { console.error("E2E encrypt failed:", e) }
    }

    if (!encryptedContent && selectedChat.is_group) {
      try {
        const groupKey = await getGroupKeyForChat(selectedChat.id)
        if (groupKey) {
          const encrypted = await encryptGroupMessage(content, groupKey)
          encryptedContent = JSON.stringify({ group_encrypted: encrypted })
          content = "[encrypted]"
        }
      } catch (e) { console.error("Group E2E failed:", e) }
    }

    let sentViaP2P = false
    if (!selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer) {
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const payload = encryptedContent || content
        const sent = p2pClient.sendMessageOrQueue(peer.id, msgId, payload)
        sentViaP2P = true
        addMessage({
          id: msgId, chat_id: selectedChat.id, user_id: currentUser.id,
          content: encryptedContent ? text : content, message_type: "text",
          created_at: new Date().toISOString(), user: currentUser, is_read: true,
          is_deleted: false, encrypted_content: encryptedContent, signature, reactions: {},
        })
        if (sent) loadChats()
      }
    }

    if (!sentViaP2P) {
      try {
        const msg = await api.sendMessage(selectedChat.id, content, "text", undefined, encryptedContent, signature)
        addMessage(msg)
        loadChats()
      } catch (e) { console.error("Send failed:", e) }
    }
    sendTyping(false)
    return true
  }, [selectedChat, replyTo, currentUser, loadChats, addMessage, sendTyping])

  const handleReply = useCallback((messageId: string, messages: MessageResponse[]) => {
    const msg = messages.find((m) => m.id === messageId)
    if (msg) setReplyTo(msg)
  }, [])

  const handleReaction = useCallback(async (messageId: string, emoji: string, add: boolean) => {
    const peerId = currentUser.id
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m
      const msgReactions = { ...(m.reactions || {}) }
      const reactors = [...(msgReactions[emoji] || [])]
      if (add) { if (!reactors.includes(peerId)) reactors.push(peerId) }
      else { const idx = reactors.indexOf(peerId); if (idx >= 0) reactors.splice(idx, 1) }
      if (reactors.length > 0) msgReactions[emoji] = reactors
      else delete msgReactions[emoji]
      return { ...m, reactions: msgReactions }
    }))
    try {
      const serverReactions = await api.toggleReaction(messageId, emoji)
      const grouped: Record<string, string[]> = {}
      for (const r of serverReactions) {
        if (!grouped[r.emoji]) grouped[r.emoji] = []
        grouped[r.emoji].push(r.user_id)
      }
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: grouped } : m))
    } catch {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m
        const msgReactions = { ...(m.reactions || {}) }
        const reactors = [...(msgReactions[emoji] || [])]
        if (!add) { if (!reactors.includes(peerId)) reactors.push(peerId) }
        else { const idx = reactors.indexOf(peerId); if (idx >= 0) reactors.splice(idx, 1) }
        if (reactors.length > 0) msgReactions[emoji] = reactors
        else delete msgReactions[emoji]
        return { ...m, reactions: msgReactions }
      }))
    }
  }, [currentUser.id, setMessages])

  const handleForward = useCallback(async (messageId: string, targetChatIds: string[]) => {
    try {
      await api.forwardMessage(messageId, targetChatIds)
      setShowForward(null)
    } catch (e) {
      setErrorToast("Не удалось переслать сообщение")
      console.error("Forward failed:", e)
    }
  }, [setErrorToast])

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    try {
      await api.editMessage(messageId, newContent)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m))
    } catch (e) {
      setErrorToast("Не удалось отредактировать")
      console.error("Edit failed:", e)
    }
  }, [setErrorToast, setMessages])

  const handleDeleteMessage = useCallback(async (messageId: string, deleteForAll = false) => {
    try {
      await api.deleteMessage(messageId, deleteForAll)
      if (deleteForAll) {
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, is_deleted: true, deleted_for_all: true } : m))
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== messageId))
      }
    } catch (e) {
      setErrorToast("Не удалось удалить")
      console.error("Delete failed:", e)
    }
  }, [setErrorToast, setMessages])

  const handlePinMessage = useCallback(async (messageId: string) => {
    if (!selectedChat) return
    try {
      const pins = await api.getPinnedMessages(selectedChat.id)
      const isPinned = pins.some(p => p.message_id === messageId)
      if (isPinned) await api.unpinMessage(selectedChat.id, messageId)
      else await api.pinMessage(selectedChat.id, messageId)
      const updated = await api.getPinnedMessages(selectedChat.id)
      setPinnedMessage(updated.length > 0 ? updated[0].message : null)
    } catch (e) {
      setErrorToast("Не удалось закрепить")
      console.error("Pin failed:", e)
    }
  }, [selectedChat, setErrorToast])

  const handlePin = useCallback(async (chatId: string) => {
    try { await api.pinChat(chatId, true); loadChats() } catch (e) {
      setErrorToast("Не удалось закрепить чат")
      console.error("Pin chat failed:", e)
    }
  }, [loadChats, setErrorToast])

  const handleMute = useCallback(async (chatId: string, isMuted: boolean) => {
    try { await api.muteChat(chatId, !isMuted); loadChats() } catch (e) {
      setErrorToast("Не удалось изменить уведомления")
      console.error("Mute failed:", e)
    }
  }, [loadChats, setErrorToast])

  const handleDeleteChat = useCallback(async (chatId: string, setSelectedChat: (c: ChatResponse | null) => void) => {
    try {
      await api.deleteChat(chatId)
      setSelectedChat(null)
      loadChats()
    } catch (e) {
      setErrorToast("Не удалось удалить чат")
      console.error("Delete chat failed:", e)
    }
  }, [loadChats, setErrorToast])

  return {
    replyTo, setReplyTo, showForward, setShowForward, pinnedMessage, setPinnedMessage,
    handleSend, handleReply, handleReaction, handleForward, handleEditMessage, handleDeleteMessage,
    handlePinMessage, handlePin, handleMute, handleDeleteChat,
  }
}
