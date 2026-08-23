import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { sendP2PTextMessage, sendP2PGroupMessage, isPeerConnected, sendP2PReaction, sendP2PMessageEdit, sendP2PMessageDelete } from "../services/p2pBridge"
import { loadKeys as loadE2EKeys, encryptMessage, isE2EEnabled } from "../services/e2e"
import { fetchGroupKey, encryptGroupMessageRatcheted } from "../services/groupE2E"
import { createSealedSenderEnvelope, type SealedSenderEnvelope } from "../services/sealedSender"
import { useChatStore } from "../store/chatStore"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
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
  const { t } = useTranslation()
  const [replyTo, setReplyTo] = useState<MessageResponse | null>(null)
  const [showForward, setShowForward] = useState<string | null>(null)
  const [pinnedMessage, setPinnedMessage] = useState<MessageResponse | null>(null)

  const handleSend = useCallback(async (input: string, expiresAt?: string) => {
    const text = input.trim()
    if (!text || !selectedChat) return false
    let content = text
    const replyToId = replyTo?.id

    const myKeys = await loadE2EKeys()
    let encryptedContent: string | undefined
    let signature: string | undefined
    if (myKeys && isE2EEnabled(selectedChat.participants, myKeys)) {
      try {
        const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
        if (peer?.public_key) {
          const envelope = await encryptMessage(content, myKeys, peer.public_key, selectedChat.id, currentUser.id, peer.id)
          encryptedContent = JSON.stringify(envelope)
          signature = envelope.signature
          content = "[encrypted]"
        }
      } catch (e) {
        // NEVER fall through to plaintext when E2E was intended — abort the send.
        console.error("E2E encrypt failed:", e)
        setErrorToast(t("errors.sendFailed"))
        return false
      }
    }

    if (!encryptedContent && selectedChat.is_group) {
      try {
        if (myKeys) {
          let groupKey = await fetchGroupKey(selectedChat.id, hexToBytes(myKeys.privateKeyHex))
          // If group key is missing (new group or after participant change), re-initialize
          if (!groupKey && selectedChat.is_group && selectedChat.participants.length > 1) {
            const { initGroupKey } = await import("../services/groupE2E")
            const participants = selectedChat.participants.map(p => ({ user_id: p.id, public_key: p.public_key }))
            await initGroupKey(selectedChat.id, hexToBytes(myKeys.privateKeyHex), currentUser.id, participants)
            groupKey = await fetchGroupKey(selectedChat.id, hexToBytes(myKeys.privateKeyHex))
          }
          if (groupKey) {
            const encrypted = await encryptGroupMessageRatcheted(content, groupKey, selectedChat.id)
            encryptedContent = JSON.stringify({ group_encrypted: encrypted })
            content = "[encrypted]"
          }
        }
      } catch (e) {
        console.error("Group E2E failed:", e)
        setErrorToast(t("errors.sendFailed"))
        return false
      }
    }

    let sentViaP2P = false
    if (!selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer && isPeerConnected(peer.id)) {
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const payload = encryptedContent || content
        const sent = sendP2PTextMessage(peer.id, msgId, payload, replyToId)
        sentViaP2P = sent
        addMessage({
          id: msgId, chat_id: selectedChat.id, user_id: currentUser.id,
          content: encryptedContent ? text : content, message_type: "text",
          created_at: new Date().toISOString(), user: currentUser, is_read: true,
          is_deleted: false, encrypted_content: encryptedContent, signature, reactions: {},
          reply_to_id: replyToId || undefined,
          reply_to: replyTo ? { id: replyTo.id, content: replyTo.content, user_id: replyTo.user_id, user: replyTo.user } : undefined,
          expires_at: expiresAt || undefined,
        })
        if (sent) loadChats()
      }
    }

    // Group E2E via P2P TCP mesh ONLY if every other participant is connected.
    // Partial P2P delivery would permanently lose the message for peers that
    // are online via relay but not on our TCP mesh — fall back to relay instead.
    if (!sentViaP2P && selectedChat.is_group && encryptedContent) {
      const others = selectedChat.participants.filter(p => p.id !== currentUser.id)
      const allConnected = others.length > 0 && others.every(p => isPeerConnected(p.id))

      if (allConnected) {
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const sent = await sendP2PGroupMessage(selectedChat.id, msgId, encryptedContent)
        sentViaP2P = sent
        addMessage({
          id: msgId, chat_id: selectedChat.id, user_id: currentUser.id,
          content: text, message_type: "text",
          created_at: new Date().toISOString(), user: currentUser, is_read: true,
          is_deleted: false, encrypted_content: encryptedContent, signature, reactions: {},
        })
        if (sentViaP2P) loadChats()
      }
      // else: leave sentViaP2P=false so the relay path below delivers to everyone
    }

    if (!sentViaP2P) {
      try {
        // Wrap in sealed sender for metadata protection (relay can't see sender)
        let sealedPayload: string | undefined
        if (encryptedContent && !selectedChat.is_group) {
          const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
          if (peer?.public_key) {
            const sealed = createSealedSenderEnvelope(peer.public_key, currentUser.id, encryptedContent)
            sealedPayload = JSON.stringify(sealed)
          }
        }

        const msg = await api.sendMessage(
          selectedChat.id,
          content,
          "text",
          undefined,
          sealedPayload || encryptedContent,
          signature,
          expiresAt || (selectedChat.is_secret && selectedChat.disappears_after_seconds
            ? new Date(Date.now() + selectedChat.disappears_after_seconds * 1000).toISOString()
            : undefined),
          replyToId,
          sealedPayload ? true : undefined, // sealed_sender flag
        )
        addMessage(msg)
        loadChats()
      } catch (e) {
        // Surface failure so the caller keeps the input and the user can retry
        console.error("Send failed:", e)
        setErrorToast(t("errors.sendFailed"))
        sendTyping(false)
        return false
      }
    }
    sendTyping(false)
    return true
  }, [selectedChat, replyTo, currentUser, loadChats, addMessage, sendTyping, setErrorToast, t])

  const handleReply = useCallback((messageId: string, messages: MessageResponse[]) => {
    const msg = messages.find((m) => m.id === messageId)
    if (msg) setReplyTo(msg)
  }, [])

  const handleReaction = useCallback(async (messageId: string, emoji: string, add: boolean) => {
    const peerId = currentUser.id
    // Optimistic update
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

    // Try P2P first for 1-on-1 chats
    if (selectedChat && !selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer && isPeerConnected(peer.id)) {
        const sent = await sendP2PReaction(peer.id, messageId, emoji, add)
        if (sent) return
      }
    }

    // Fallback to server API
    try {
      const serverReactions = await api.toggleReaction(messageId, emoji)
      const grouped: Record<string, string[]> = {}
      for (const r of serverReactions) {
        if (!grouped[r.emoji]) grouped[r.emoji] = []
        grouped[r.emoji].push(r.user_id)
      }
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: grouped } : m))
    } catch {
      // Rollback optimistic update
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
  }, [currentUser.id, selectedChat, setMessages])

  const handleForward = useCallback(async (messageId: string, targetChatIds: string[]) => {
    try {
      await api.forwardMessage(messageId, targetChatIds)
      setShowForward(null)
    } catch (e) {
      setErrorToast(t("errors.forwardFailed"))
      console.error("Forward failed:", e)
    }
  }, [setErrorToast, t])

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    // Try P2P first for 1-on-1 chats
    if (selectedChat && !selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer && isPeerConnected(peer.id)) {
        const sent = await sendP2PMessageEdit(peer.id, messageId, newContent)
        if (sent) {
          setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m))
          return
        }
      }
    }
    try {
      await api.editMessage(messageId, newContent)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m))
    } catch (e) {
      setErrorToast(t("errors.editFailed"))
      console.error("Edit failed:", e)
    }
  }, [selectedChat, currentUser.id, setErrorToast, setMessages, t])

  const handleDeleteMessage = useCallback(async (messageId: string, deleteForAll = false) => {
    // Try P2P first for 1-on-1 chats
    if (selectedChat && !selectedChat.is_group && selectedChat.participants.length === 2) {
      const peer = selectedChat.participants.find(p => p.id !== currentUser.id)
      if (peer && isPeerConnected(peer.id)) {
        const sent = await sendP2PMessageDelete(peer.id, messageId, deleteForAll)
        if (sent) {
          if (deleteForAll) {
            setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, is_deleted: true, deleted_for_all: true } : m))
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== messageId))
          }
          return
        }
      }
    }
    try {
      await api.deleteMessage(messageId, deleteForAll)
      if (deleteForAll) {
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, is_deleted: true, deleted_for_all: true } : m))
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== messageId))
      }
    } catch (e) {
      setErrorToast(t("errors.deleteFailed"))
      console.error("Delete failed:", e)
    }
  }, [selectedChat, currentUser.id, setErrorToast, setMessages, t])

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
      setErrorToast(t("errors.pinFailed"))
      console.error("Pin failed:", e)
    }
  }, [selectedChat, setErrorToast, t])

  const handlePin = useCallback(async (chatId: string, isPinned: boolean) => {
    try { await api.pinChat(chatId, isPinned); loadChats() } catch (e) {
      setErrorToast(t("errors.pinChatFailed"))
      console.error("Pin chat failed:", e)
    }
  }, [loadChats, setErrorToast, t])

  const handleMute = useCallback(async (chatId: string, isMuted: boolean) => {
    try { await api.muteChat(chatId, isMuted); loadChats() } catch (e) {
      setErrorToast(t("errors.muteFailed"))
      console.error("Mute failed:", e)
    }
  }, [loadChats, setErrorToast, t])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await api.deleteChat(chatId)
      useChatStore.getState().setSelectedChat(null)
      loadChats()
    } catch (e) {
      setErrorToast(t("errors.deleteChatFailed"))
      console.error("Delete chat failed:", e)
    }
  }, [loadChats, setErrorToast, t])

  return {
    replyTo, setReplyTo, showForward, setShowForward, pinnedMessage, setPinnedMessage,
    handleSend, handleReply, handleReaction, handleForward, handleEditMessage, handleDeleteMessage,
    handlePinMessage, handlePin, handleMute, handleDeleteChat,
  }
}
