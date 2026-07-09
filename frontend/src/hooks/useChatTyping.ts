import { useState, useCallback, useRef } from "react"

export function useChatTyping(sendWs: (data: any) => void) {
  const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, boolean>>>({})
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sendTyping = useCallback((isTyping: boolean, chatId?: string) => {
    if (!chatId) return
    sendWs({ event: "typing", data: { chat_id: chatId, is_typing: isTyping } })
  }, [sendWs])

  return { typingUsers, setTypingUsers, sendTyping, typingTimerRef }
}
