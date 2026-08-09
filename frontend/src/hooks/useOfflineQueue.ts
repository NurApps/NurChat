import { useState, useEffect, useCallback, useRef } from "react"
import {
  getPendingMessages,
  removeMessage,
  updateMessageRetries,
  getRetryDelay,
  shouldRetry,
} from "../services/offlineQueue"
import { api } from "../services/api"

const MAX_RETRIES = 5

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>()

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

  const updatePendingCount = useCallback(async () => {
    const messages = await getPendingMessages()
    setPendingCount(messages.length)
  }, [])

  useEffect(() => {
    updatePendingCount()
  }, [updatePendingCount])

  const processQueue = useCallback(async () => {
    if (!navigator.onLine) return
    const messages = await getPendingMessages()
    for (const msg of messages) {
      try {
        if (msg.messageType === "text") {
          await api.sendMessage(msg.chatId, msg.content)
        } else if (msg.messageType === "file" && msg.fileId) {
          await api.sendFileMessage(msg.chatId, msg.fileId, msg.content)
        }
        await removeMessage(msg.id)
      } catch (err: any) {
        if (shouldRetry(msg.retries)) {
          await updateMessageRetries(msg.id, err.message || "Unknown error")
        } else {
          await removeMessage(msg.id)
        }
      }
    }
    await updatePendingCount()
  }, [updatePendingCount])

  useEffect(() => {
    if (isOnline) {
      processQueue()
    }
  }, [isOnline, processQueue])

  useEffect(() => {
    if (pendingCount > 0 && isOnline) {
      retryTimerRef.current = setTimeout(processQueue, 5000)
      return () => clearTimeout(retryTimerRef.current)
    }
  }, [pendingCount, isOnline, processQueue])

  return { isOnline, pendingCount, processQueue }
}
