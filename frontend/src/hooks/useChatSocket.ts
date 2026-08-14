import { useCallback, useRef, useEffect } from "react"
import { WS_BASE } from "../config"
import { showNotification } from "../services/notifications"
import type { MessageResponse, UserResponse, ChatResponse } from "../types"

type TypingUsers = Record<string, Record<string, boolean>>
type OnlineUsers = Record<string, boolean>
type Reactions = Record<string, Record<string, string[]>>
type Toast = { id: string; title: string; body: string; chatId?: string } | null
type IncomingCall = { callId: string; callerId: string; callerName: string; callType: string } | null

interface UseChatSocketOptions {
  currentUser: UserResponse
  selectedChat: ChatResponse | null
  onMessage: (msg: MessageResponse) => void
  onChatUpdate: () => void
  onToast: (toast: Toast) => void
  onIncomingCall: (call: IncomingCall) => void
  onTypingUsers: (fn: (prev: TypingUsers) => TypingUsers) => void
  onOnlineUsers: (fn: (prev: OnlineUsers) => OnlineUsers) => void
  onReactions: (fn: (prev: Reactions) => Reactions) => void
  onMention: (data: { chat_id: string; message_id: string; mentioned_by: string; mentioned_by_username: string; content_preview: string }) => void
  onNavigate: (path: string) => void
}

export function useChatSocket({
  currentUser, selectedChat, onMessage, onChatUpdate, onToast, onIncomingCall, onTypingUsers, onOnlineUsers, onReactions, onMention, onNavigate,
}: UseChatSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const chatIdRef = useRef<string | null>(null)

  // Stable refs so callbacks don't force WS reconnection on every render
  const handlersRef = useRef({ onMessage, onChatUpdate, onToast, onIncomingCall, onTypingUsers, onOnlineUsers, onReactions, onMention, onNavigate, currentUserId: currentUser.id })
  useEffect(() => {
    handlersRef.current = { onMessage, onChatUpdate, onToast, onIncomingCall, onTypingUsers, onOnlineUsers, onReactions, onMention, onNavigate, currentUserId: currentUser.id }
  })

  useEffect(() => {
    chatIdRef.current = selectedChat?.id || null
  }, [selectedChat])

  const handleWsEvent = useCallback(async (msg: any) => {
    const event = msg.event
    let data = msg.data || {}
    const {
      onMessage, onChatUpdate, onToast, onIncomingCall, onTypingUsers, onOnlineUsers, onReactions, onMention, onNavigate, currentUserId,
    } = handlersRef.current

    switch (event) {
      case "typing": {
        if (data.chat_id && data.user_id !== currentUserId) {
          onTypingUsers((prev) => ({
            ...prev,
            [data.chat_id]: { ...prev[data.chat_id], [data.user_id]: data.is_typing }
          }))
          if (data.is_typing) {
            setTimeout(() => {
              onTypingUsers((prev) => {
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
        if (data.user_id) onOnlineUsers((prev) => ({ ...prev, [data.user_id]: true }))
        break
      }
      case "user_offline": {
        if (data.user_id) onOnlineUsers((prev) => ({ ...prev, [data.user_id]: false }))
        break
      }
      case "message": {
        if (data.chat_id === chatIdRef.current && data.user_id !== currentUserId) {
          onMessage(data)
        }
        onChatUpdate()
        if (data.chat_id !== chatIdRef.current) {
          const sender = data.username || "Пользователь"
          const preview = (data.content || "").slice(0, 50)
          onToast({ id: data.id, title: sender, body: preview, chatId: data.chat_id })
          showNotification(sender, preview)
        }
        break
      }
      case "new_message": {
        if (data.chat_id === chatIdRef.current && data.user_id !== currentUserId) {
          onMessage(data)
        }
        onChatUpdate()
        break
      }
      case "message_delivered": {
        if (data.chat_id === chatIdRef.current && data.message_id) {
          onMessage({ ...data, is_read: true, _update: true })
        }
        break
      }
      case "delete_message": {
        if (data.message_id) {
          onMessage({ ...data, _delete: true, delete_for_all: data.delete_for_all })
        }
        break
      }
      case "edit_message": {
        if (data.message_id && data.new_content) {
          onMessage({ ...data, _edit: true, content: data.new_content, edited_at: data.edited_at })
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
          onReactions((prev) => ({ ...prev, [data.message_id]: grouped }))
        }
        break
      }
      case "call_incoming": {
        onIncomingCall({
          callId: data.call_id,
          callerId: data.caller_id,
          callerName: data.caller_name || "Пользователь",
          callType: data.call_type || "audio",
        })
        break
      }
      case "call_accept_response": {
        if (data.call_id && data.caller_id) {
          onNavigate(`/call/${data.caller_id}/audio`)
        }
        break
      }
      case "call_reject_response": {
        onIncomingCall(null)
        break
      }
      case "mention": {
        onMention(data)
        break
      }
    }
  }, [])

  useEffect(() => {
    const userId = currentUser.id
    const token = localStorage.getItem("token")
    if (!token || userId === "self") return

    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/chat/${userId}?token=${encodeURIComponent(token!)}`)
      wsRef.current = ws
      ws.onopen = () => console.log("WS connected")
      ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          handleWsEvent(msg)
        } catch (e) { console.error("WS parse error:", e) }
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [currentUser.id, handleWsEvent])

  const sendWs = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { wsRef, chatIdRef, sendWs }
}
