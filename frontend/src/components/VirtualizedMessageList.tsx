import { useRef, useEffect, useCallback } from "react"
import { List } from "react-window"
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
  scrollToMessageId?: string | null
}

const ROW_HEIGHT = 80

export default function VirtualizedMessageList({
  messages, currentUser, reactions = {}, bookmarkedIds = new Set(), searchQuery,
  onReply, onDelete, onForward, onReaction, onEdit, onViewProfile, onBookmark, onPin, onShowInfo,
  scrollToMessageId,
}: Props) {
  const listRef = useRef<List>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scrollToMessageId || !listRef.current) return
    const idx = messages.findIndex((m) => m.id === scrollToMessageId)
    if (idx >= 0) listRef.current.scrollToItem(idx, "center")
  }, [scrollToMessageId, messages])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    if (isNearBottom && listRef.current) {
      listRef.current.scrollToItem(messages.length - 1, "end")
    }
  }, [messages.length])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollToItem(messages.length - 1, "end")
    }
  }, [messages.length])

  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const msg = messages[index]
    if (!msg) return null
    return (
      <div style={style} id={`msg-${msg.id}`}>
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
  }, [messages, currentUser, reactions, bookmarkedIds, searchQuery,
      onReply, onDelete, onForward, onReaction, onEdit, onViewProfile, onBookmark, onPin, onShowInfo])

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: "auto" }}>
      <List
        ref={listRef}
        height={600}
        itemCount={messages.length}
        itemSize={ROW_HEIGHT}
        width="100%"
        overscanCount={5}
      >
        {Row}
      </List>
    </div>
  )
}
