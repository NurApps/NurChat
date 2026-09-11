import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { loadKeys as loadE2EKeys, encryptMessage, isE2EEnabled } from "../services/e2e"
import { fetchGroupKey, encryptGroupMessageRatcheted } from "../services/groupE2E"
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

  // Шифрование подписи сообщения (текст, имя файла, "Голосовое сообщение").
  // Группы — всегда групповой ключ, лички — 1-1 Double Ratchet (см. коммент
  // в handleSend). Используется и для вложений/войсов: без конверта глухой
  // relay отвечает 400 и файлы вообще не отправляются.
  const encryptCaption = useCallback(async (
    chat: ChatResponse, text: string,
  ): Promise<{ content: string; encryptedContent?: string; signature?: string }> => {
    const myKeys = await loadE2EKeys()
    let content = text
    let encryptedContent: string | undefined
    let signature: string | undefined
    if (myKeys && chat.is_group) {
      let groupKey = await fetchGroupKey(chat.id, hexToBytes(myKeys.privateKeyHex))
      if (!groupKey && chat.participants.length > 1) {
        const { initGroupKey } = await import("../services/groupE2E")
        const participants = chat.participants.map(p => ({ user_id: p.id, public_key: p.public_key }))
        await initGroupKey(chat.id, hexToBytes(myKeys.privateKeyHex), currentUser.id, participants)
        groupKey = await fetchGroupKey(chat.id, hexToBytes(myKeys.privateKeyHex))
      }
      if (groupKey) {
        const encrypted = await encryptGroupMessageRatcheted(content, groupKey, chat.id)
        encryptedContent = JSON.stringify({ group_encrypted: encrypted })
        content = "[encrypted]"
      }
    } else if (myKeys && isE2EEnabled(chat.participants, myKeys)) {
      const peer = chat.participants.find(p => p.id !== currentUser.id)
      if (peer?.public_key) {
        const envelope = await encryptMessage(content, myKeys, peer.public_key, chat.id, currentUser.id, peer.id)
        encryptedContent = JSON.stringify(envelope)
        signature = envelope.signature
        content = "[encrypted]"
      }
    }
    return { content, encryptedContent, signature }
  }, [currentUser])

  const handleSend = useCallback(async (input: string, expiresAt?: string) => {
    const text = input.trim()
    if (!text || !selectedChat) return false
    const replyToId = replyTo?.id

    // E2E-маршрутизация (2026-09, unified): групповые чаты ВСЕГДА шифруются
    // общим групповым ключом (обёрнут per-user через ECDH, хранится на
    // сервере только в завёрнутом виде). Раньше групповой чат, где у всех
    // были public_key, ошибочно уходил в 1-1 Double Ratchet с первым пиром —
    // остальные участники не могли расшифровать.
    let content: string
    let encryptedContent: string | undefined
    let signature: string | undefined
    try {
      ({ content, encryptedContent, signature } = await encryptCaption(selectedChat, text))
    } catch (e) {
      console.error("E2E encrypt failed:", e)
      setErrorToast(t("errors.sendFailed"))
      return false
    }

    try {
      const msg = await api.sendMessage(
        selectedChat.id,
        content,
        "text",
        undefined,
        encryptedContent,
        signature,
        expiresAt || (selectedChat.is_secret && selectedChat.disappears_after_seconds
          ? new Date(Date.now() + selectedChat.disappears_after_seconds * 1000).toISOString()
          : undefined),
        replyToId,
      )
      addMessage(msg)
      loadChats()
    } catch (e) {
      console.error("Send failed:", e)
      setErrorToast(t("errors.sendFailed"))
      sendTyping(false)
      return false
    }
    sendTyping(false)
    return true
  }, [selectedChat, replyTo, currentUser, loadChats, addMessage, sendTyping, setErrorToast, t, encryptCaption])

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

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    try {
      await api.editMessage(messageId, newContent)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m))
    } catch (e) {
      setErrorToast(t("errors.editFailed"))
      console.error("Edit failed:", e)
    }
  }, [setErrorToast, setMessages, t])

  const handleDeleteMessage = useCallback(async (messageId: string, deleteForAll = false) => {
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
  }, [setErrorToast, setMessages, t])

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

  // Вложение/войс: аплоад байтов + E2E-подпись (caption). Без конверта глухой
  // relay отвечает 400 — раньше файлы/войсы в deaf-режиме не уходили вообще.
  const handleSendAttachment = useCallback(async (
    chat: ChatResponse, file: File, fileType: string, caption: string,
    onProgress?: (percent: number) => void,
  ): Promise<boolean> => {
    try {
      const uploaded = await api.uploadFile(file, fileType, onProgress)
      const { content, encryptedContent, signature } = await encryptCaption(chat, caption)
      const msg = await api.sendMessage(chat.id, content, fileType, uploaded.id, encryptedContent, signature)
      addMessage(msg)
      loadChats()
      return true
    } catch (e) {
      console.error("Attachment send failed:", e)
      setErrorToast(t("errors.fileUpload", { name: file.name }))
      return false
    }
  }, [addMessage, loadChats, setErrorToast, t, encryptCaption])

  return {
    replyTo, setReplyTo,
    handleSend, handleReply, handleReaction, handleEditMessage, handleDeleteMessage,
    handlePin, handleMute, handleDeleteChat, handleSendAttachment,
  }
}
