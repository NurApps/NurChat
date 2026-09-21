import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "../services/api"
import { savePlaintext } from "../services/plaintextCache"
import { loadKeys as loadE2EKeys, encryptMessage, isE2EEnabled, reactionTag, encryptReactionEmoji, groupReactionRows } from "../services/e2e"
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

    const effectiveExpiresAt = expiresAt || (selectedChat.is_secret && selectedChat.disappears_after_seconds
      ? new Date(Date.now() + selectedChat.disappears_after_seconds * 1000).toISOString()
      : undefined)
    try {
      const msg = await api.sendMessage(
        selectedChat.id,
        content,
        "text",
        undefined,
        encryptedContent,
        signature,
        effectiveExpiresAt,
        replyToId,
      )
      // Сервер хранит content="[encrypted]"; подменяем на исходный текст,
      // чтобы отправитель видел своё сообщение, а не "[encrypted]".
      // Копия текста — в локальный кэш: свои сообщения из истории
      // расшифровать нельзя (Double Ratchet), без кэша после
      // перезахода будет "[не удалось расшифровать]".
      if (encryptedContent) msg.content = text
      if (msg.id) savePlaintext(msg.id, text)
      addMessage(msg)
      loadChats()
    } catch (e) {
      console.error("Send failed:", e)
      // Глухой relay отбил plaintext (нет конверта — нет ключей пира):
      // класть в outbox БЕССМЫСЛЕННО, flush будет так же 400ить до poison
      // и сообщение «исчезнет». Говорим прямо, в очередь не кладём.
      const detail = e instanceof Error ? e.message : String(e)
      if (/глух|deaf|only E2E/i.test(detail)) {
        setErrorToast(t("errors.e2eKeysMissing"))
        sendTyping(false)
        return false
      }
      // Оффлайн: кладём плейнтекст в локальный outbox — уйдёт само при
      // появлении связи (flushOutbox перешифрует свежими ключами).
      try {
        const { queueOutboxMessage } = await import("../services/outbox")
        await queueOutboxMessage({
          chatId: selectedChat.id, text, replyToId, expiresAt: effectiveExpiresAt,
        })
        setErrorToast(t("errors.sendQueued"))
        sendTyping(false)
        return true // инпут можно чистить — текст в надёжной очереди
      } catch {
        setErrorToast(t("errors.sendFailed"))
        sendTyping(false)
        return false
      }
    }
    sendTyping(false)
    return true
  }, [selectedChat, replyTo, currentUser, loadChats, addMessage, sendTyping, setErrorToast, t, encryptCaption])

  // Отправка накопленного outbox: вызывается при реконнекте WS / online.
  // Возвращает число реально ушедших сообщений.
  const flushOutbox = useCallback(async (): Promise<number> => {
    let items
    try {
      const m = await import("../services/outbox")
      items = await m.listOutbox()
      if (!items.length) return 0
    } catch { return 0 }
    const { removeOutbox, bumpOutboxAttempts, isPoison } = await import("../services/outbox")
    let chats: ChatResponse[] | null = null
    let sent = 0
    for (const item of items) {
      try {
        if (item.id === undefined || isPoison(item)) {
          if (item.id !== undefined) await removeOutbox(item.id)
          continue
        }
        if (!chats) chats = await api.getChats()
        const chat = chats.find((c) => c.id === item.chatId)
        if (!chat) { await removeOutbox(item.id as number); continue } // чат удалён
        const { content, encryptedContent, signature } = await encryptCaption(chat, item.text)
        const msg = await api.sendMessage(
          chat.id, content, "text", undefined, encryptedContent, signature,
          item.expiresAt, item.replyToId,
        )
        await removeOutbox(item.id as number)
        sent++
        if (encryptedContent) msg.content = item.text
        if (msg.id) savePlaintext(msg.id, item.text)
        if (selectedChat?.id === chat.id) addMessage(msg)
      } catch {
        await bumpOutboxAttempts(item) // яд копится до isPoison, потом дроп
      }
    }
    if (sent) loadChats()
    return sent
  }, [selectedChat, addMessage, loadChats, encryptCaption])

  const handleReply = useCallback((messageId: string, messages: MessageResponse[]) => {
    const msg = messages.find((m) => m.id === messageId)
    if (msg) setReplyTo(msg)
  }, [])

  const handleReaction = useCallback(async (messageId: string, emoji: string, add: boolean) => {
    const peerId = currentUser.id
    const revert = () => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m
        const msgReactions = { ...(Array.isArray(m.reactions) ? {} : (m.reactions || {})) }
        const reactors = [...(msgReactions[emoji] || [])]
        if (!add) { if (!reactors.includes(peerId)) reactors.push(peerId) }
        else { const idx = reactors.indexOf(peerId); if (idx >= 0) reactors.splice(idx, 1) }
        if (reactors.length > 0) msgReactions[emoji] = reactors
        else delete msgReactions[emoji]
        return { ...m, reactions: msgReactions }
      }))
    }

    // Optimistic local update (plaintext emoji never leaves the device here).
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m
      const msgReactions = { ...(Array.isArray(m.reactions) ? {} : (m.reactions || {})) }
      const reactors = [...(msgReactions[emoji] || [])]
      if (add) { if (!reactors.includes(peerId)) reactors.push(peerId) }
      else { const idx = reactors.indexOf(peerId); if (idx >= 0) reactors.splice(idx, 1) }
      if (reactors.length > 0) msgReactions[emoji] = reactors
      else delete msgReactions[emoji]
      return { ...m, reactions: msgReactions }
    }))

    try {
      // E2E reaction: blinded toggle tag + encrypted emoji. The relay matches
      // the tag for untoggle and stores ciphertext — emoji stays on devices.
      // No plaintext fallback: a relay that can't see content is the point.
      const myKeys = await loadE2EKeys()
      if (!myKeys || !selectedChat) { revert(); return }
      const tag = reactionTag(myKeys.privateKeyHex, messageId, emoji)
      const enc = await encryptReactionEmoji(selectedChat, myKeys, currentUser.id, emoji)
      if (!enc) { revert(); return }
      const serverReactions = await api.toggleReaction(messageId, tag, enc)
      const grouped = await groupReactionRows(serverReactions, selectedChat, myKeys)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: grouped } : m))
    } catch {
      revert()
    }
  }, [currentUser.id, selectedChat, setMessages])

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    try {
      // Глухой relay принимает только E2E-правки: шифруем тем же маршрутом,
      // что и отправку (группы — групповой ключ, лички — 1-1 ратчет).
      // Плейнтекст в query больше не шлём (тёк в логи/прокси).
      let body: { content: string; encrypted_content?: string; signature?: string } = { content: newContent }
      if (selectedChat) {
        try {
          const enc = await encryptCaption(selectedChat, newContent)
          body = { content: enc.content, encrypted_content: enc.encryptedContent, signature: enc.signature }
        } catch (e) {
          console.error("E2E encrypt (edit) failed:", e)
          setErrorToast(t("errors.editFailed"))
          return
        }
      }
      await api.editMessage(messageId, body)
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m))
    } catch (e) {
      setErrorToast(t("errors.editFailed"))
      console.error("Edit failed:", e)
    }
  }, [selectedChat, setErrorToast, setMessages, t, encryptCaption])

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

  // Вложение/войс: true E2E — байты шифруются fileKey (XSalsa20-Poly1305),
  // ключ оборачивается per-recipient через ECDH. Relay хранит только ciphertext.
  // Подпись вложения (caption) — как раньше E2E, иначе глухой relay 400.
  const handleSendAttachment = useCallback(async (
    chat: ChatResponse, file: File, fileType: string, caption: string,
    onProgress?: (percent: number) => void,
  ): Promise<boolean> => {
    try {
      const myKeys = await loadE2EKeys()
      const shouldEncryptBytes = !!(myKeys && (chat.is_group || isE2EEnabled(chat.participants, myKeys)))
      let uploaded: { id: string } | null = null
      let fileEnvelope: { v: number; wrapped: Record<string, string>; senderPublicKey: string } | null = null
      let fileToUpload: File = file
      let isEncryptedUpload = false

      if (shouldEncryptBytes && myKeys) {
        try {
          const { generateFileKey, encryptFileBytes, wrapFileKey } = await import("../services/fileE2E")
          const plain = new Uint8Array(await file.arrayBuffer())
          const fileKey = generateFileKey()
          const cipherWithNonce = encryptFileBytes(plain, fileKey)
          const wrapped: Record<string, string> = {}
          for (const p of chat.participants) {
            if (!p.public_key) continue
            try { wrapped[p.id] = wrapFileKey(fileKey, myKeys.privateKeyHex, p.public_key) } catch {}
          }
          // Fallback: ensure at least self is included
          if (!wrapped[currentUser.id] && myKeys.publicKeyHex) {
            try { wrapped[currentUser.id] = wrapFileKey(fileKey, myKeys.privateKeyHex, myKeys.publicKeyHex) } catch {}
          }
          fileEnvelope = { v: 1, wrapped, senderPublicKey: myKeys.publicKeyHex }
          const blob = new Blob([cipherWithNonce as BlobPart], { type: "application/octet-stream" })
          // Filename on relay must not leak original name: use opaque name. Original name stays in encrypted caption.
          fileToUpload = new File([blob], `enc_${fileType}_${Date.now()}.bin`, { type: "application/octet-stream" })
          isEncryptedUpload = true
        } catch (e) {
          console.warn("[E2E file] bytes encrypt failed, fallback to plaintext upload:", e)
          fileToUpload = file
          isEncryptedUpload = false
          fileEnvelope = null
        }
      }

      uploaded = await api.uploadFile(fileToUpload, fileType, onProgress, isEncryptedUpload)

      // Encrypt caption; then embed file envelope into encrypted_content JSON
      let content: string
      let encryptedContent: string | undefined
      let signature: string | undefined
      try {
        const enc = await encryptCaption(chat, caption)
        content = enc.content
        encryptedContent = enc.encryptedContent
        signature = enc.signature
        if (fileEnvelope && encryptedContent) {
          try {
            const parsed = JSON.parse(encryptedContent)
            parsed.file = fileEnvelope
            encryptedContent = JSON.stringify(parsed)
          } catch {
            encryptedContent = JSON.stringify({ file: fileEnvelope, fallback: encryptedContent })
          }
        } else if (fileEnvelope && !encryptedContent) {
          // Chat not E2E-capable but file bytes are encrypted: still need to send envelope
          // Send as plaintext content with file envelope in separate field (non-deaf fallback)
          encryptedContent = JSON.stringify({ file: fileEnvelope })
          content = caption || "[file]"
        }
      } catch (e) {
        console.error("E2E encrypt (caption+file) failed:", e)
        setErrorToast(t("errors.sendFailed"))
        return false
      }

      const msg = await api.sendMessage(chat.id, content, fileType, uploaded.id, encryptedContent, signature)
      // Сервер хранит content="[encrypted]"; подменяем на подпись,
      // чтобы отправитель видел «Голосовое сообщение», а не "[encrypted]".
      if (encryptedContent) msg.content = caption
      if (msg.id) savePlaintext(msg.id, caption)
      addMessage(msg)
      loadChats()
      return true
    } catch (e) {
      console.error("Attachment send failed:", e)
      setErrorToast(t("errors.fileUpload", { name: file.name }))
      return false
    }
  }, [addMessage, loadChats, setErrorToast, t, encryptCaption, currentUser])

  return {
    replyTo, setReplyTo,
    handleSend, handleReply, handleReaction, handleEditMessage, handleDeleteMessage,
    handlePin, handleMute, handleDeleteChat, handleSendAttachment, flushOutbox,
  }
}
