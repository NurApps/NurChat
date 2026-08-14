import { useCallback, useRef } from "react"
import { List, useDynamicRowHeight, useListRef } from "react-window"
import MessageBubble from "./MessageBubble"
import type { MessageResponse, UserResponse } from "../types"

interface RowProps {
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

interface Props extends RowProps {
  scrollToMessageId?: string | null
}

const DEFAULT_ROW_HEIGHT = 80

const Row = ({
  index, style, messages, currentUser, reactions = {}, bookmarkedIds = new Set(), searchQuery,
  onReply, onDelete, onForward, onReaction, onEdit, onViewProfile, onBookmark, onPin, onShowInfo,
}: RowProps & { index: number; style: React.CSSProperties }) => {
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
}

export default function VirtualizedMessageList(props: Props) {
  const { messages, scrollToMessageId, ...rowProps } = props
  const listRef = useListRef<{ scrollToRow(config: { align?: string; behavior?: string; index: number }): void }>()
  const scrollLockRef = useRef(false)

  const rowHeight = useDynamicRowHeight({ defaultRowHeight: DEFAULT_ROW_HEIGHT, key: messages.length })

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    if (messages.length === 0) return
    scrollLockRef.current = true
    listRef.current?.scrollToRow({ index: messages.length - 1, align: "end", behavior })
    window.setTimeout(() => { scrollLockRef.current = false }, 150)
  }, [messages.length, listRef])

  const handleScrollToMessage = useCallback(() => {
    if (!scrollToMessageId || messages.length === 0) return
    const idx = messages.findIndex((m) => m.id === scrollToMessageId)
    if (idx >= 0) listRef.current?.scrollToRow({ index: idx, align: "center" })
  }, [scrollToMessageId, messages, listRef])

  const handleResize = useCallback(() => {
    if (!scrollLockRef.current) scrollToBottom()
  }, [scrollToBottom])

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <List
        className="virtualized-message-list"
        listRef={listRef}
        rowCount={messages.length}
        rowHeight={rowHeight}
        rowComponent={Row}
        rowProps={{ messages, ...rowProps }}
        overscanCount={6}
        onResize={handleResize}
        style={{ height: "100%" }}
      />
    </div>
  )
}