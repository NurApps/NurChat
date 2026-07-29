import { useRef, useEffect, useState, useCallback } from "react"
import MessageBubble from "./MessageBubble"
import type { MessageResponse, UserResponse } from "../types"

interface Props {
  messages: MessageResponse[]
  currentUser: UserResponse
  reactions?: Record<string, Record<string, string[]>>
  bookmarkedIds?: Set<string>
  searchQuery?: string
  onReply: (id: string) => void
  onDelete: (id: string, deleteForAll?: boolean) => void
  onForward: (id: string) => void
  onReaction: (id: string, emoji: string, add: boolean) => void
  onEdit: (id: string, content: string) => void
  onViewProfile: (user: UserResponse) => void
  onBookmark: (id: string) => void
  onPin: (id: string) => void
  onShowInfo: (id: string) => void
}

const ROW_HEIGHT = 100
const OVERSCAN = 5

export default function VirtualizedMessageList({
  messages, currentUser, reactions = {}, bookmarkedIds = new Set(), searchQuery,
  onReply, onDelete, onForward, onReaction, onEdit, onViewProfile, onBookmark, onPin, onShowInfo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerHeight(el.clientHeight)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const totalHeight = messages.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(messages.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
  const visibleMessages = messages.slice(startIndex, endIndex)

  const handleScroll = useCallback(() => {
    setScrollTop(containerRef.current?.scrollTop || 0)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length])

  return (
    <div ref={containerRef} style={{ height: 600, overflow: "auto", position: "relative" }}>
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleMessages.map((msg, i) => {
          const actualIndex = startIndex + i
          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              style={{
                position: "absolute",
                top: actualIndex * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
                padding: "0 12px",
              }}
            >
              <MessageBubble
                message={msg}
                currentUser={currentUser}
                isMyMessage={msg.user_id === currentUser.id}
                isRead={msg.is_read}
                reactions={reactions[msg.id]}
                onReply={onReply}
                onDelete={onDelete}
                onForward={onForward}
                onReaction={onReaction}
                onEdit={onEdit}
                onViewProfile={onViewProfile}
                onBookmark={onBookmark}
                isBookmarked={bookmarkedIds.has(msg.id)}
                onPin={onPin}
                highlightQuery={searchQuery}
                onShowInfo={onShowInfo}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
