import { useState, useCallback, useRef } from "react"
import { api } from "../services/api"
import { decryptMessage, isE2EEnabled, type E2EKeys } from "../services/e2e"
import { getGroupKeyForChat, decryptGroupMessage } from "../services/groupE2E"
import type { ChatResponse, MessageResponse, UserResponse } from "../types"

interface UseChatMessagesOptions {
  currentUser: UserResponse
  e2eKeys: E2EKeys | null
}

export function useChatMessages({ currentUser, e2eKeys }: UseChatMessagesOptions) {
  const [messages, setMessages] = useState<MessageResponse[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const decryptMessages = useCallback(async (msgs: MessageResponse[], chat: ChatResponse): Promise<MessageResponse[]> => {
    if (!e2eKeys || !isE2EEnabled(chat.participants, e2eKeys)) return msgs
    const peer = chat.participants.find(p => p.id !== currentUser.id)
    if (!peer?.public_key) return msgs

    let groupKey: CryptoKey | null = null
    if (chat.is_group) {
      try { groupKey = await getGroupKeyForChat(chat.id) } catch {}
    }

    const results: MessageResponse[] = []
    for (const msg of msgs) {
      if (msg.encrypted_content) {
        try {
          const envelope = JSON.parse(msg.encrypted_content)
          if (envelope.group_encrypted && groupKey) {
            try {
              const plain = await decryptGroupMessage(envelope.group_encrypted, groupKey)
              results.push({ ...msg, content: plain || "[не удалось расшифровать]" })
            } catch {
              results.push({ ...msg, content: "[ошибка расшифровки группы]" })
            }
          } else {
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

  const loadMessages = useCallback(async (chat: ChatResponse) => {
    try {
      const msgs = await api.getChatMessages(chat.id, 0, 50)
      const decrypted = await decryptMessages(msgs, chat)
      setMessages(decrypted)
      setHasMore(decrypted.length >= 50)
    } catch (e) {
      console.error("Load messages failed:", e)
    }
  }, [decryptMessages])

  const loadMore = useCallback(async (chat: ChatResponse) => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const older = await api.getChatMessages(chat.id, messages.length, 50)
      const decrypted = await decryptMessages(older, chat)
      setMessages((prev) => [...decrypted, ...prev])
      setHasMore(older.length >= 50)
    } catch (e) {
      console.error("Load more failed:", e)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, messages.length, decryptMessages])

  const handleWsMessage = useCallback((data: any) => {
    if (data._update) {
      setMessages((prev) => prev.map((m) => m.id === data.message_id ? { ...m, is_read: true } : m))
    } else if (data._delete) {
      setMessages((prev) => prev.map((m) =>
        m.id === data.message_id ? { ...m, is_deleted: true, deleted_for_all: data.delete_for_all || false } : m
      ))
    } else if (data._edit) {
      setMessages((prev) => prev.map((m) => m.id === data.message_id ? { ...m, content: data.content } : m))
    } else {
      setMessages((prev) => [...prev, data])
    }
  }, [])

  const addMessage = useCallback((msg: MessageResponse) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<MessageResponse>) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, ...updates } : m))
  }, [])

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return {
    messages, setMessages, loadingMore, hasMore, containerRef, endRef,
    loadMessages, loadMore, handleWsMessage, addMessage, updateMessage, removeMessage, setHasMore,
  }
}
