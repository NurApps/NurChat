import { useCallback, useEffect, useRef } from "react"
import { List, useDynamicRowHeight, useListRef } from "react-window"
import MessageBubble from "./MessageBubble"
import type { MessageResponse, UserResponse } from "../types"

interface RowProps {
  messages: MessageResponse[]
  currentUser: UserResponse
  reactions?: Record<string, Record<string, string[]>>
  searchQuery?: string
  onReply: (id: string) => void
  onDelete: (id: string, deleteForAll?: boolean) => void
  onReaction: (id: string, emoji: string, add: boolean) => void
  onEdit: (id: string, content: string) => void
  onViewProfile: (user: UserResponse) => void
  onShowInfo: (id: string) => void
  onOpenViewOnce?: (m: MessageResponse) => Promise<{ text?: string; fileUrl?: string } | null>
}

interface Props extends RowProps {
  scrollToMessageId?: string | null
  /** Дозагрузка истории: внутренний скроллер react-window, а не внешний div. */
  onNearTop?: () => void
}

const DEFAULT_ROW_HEIGHT = 80

const Row = ({
  index, style, messages, currentUser, reactions = {}, searchQuery,
  onReply, onDelete, onReaction, onEdit, onViewProfile, onShowInfo, onOpenViewOnce,
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
        onReaction={onReaction}
        onEdit={onEdit}
        onViewProfile={onViewProfile}
        highlightQuery={searchQuery}
        onShowInfo={onShowInfo}
        onOpenViewOnce={onOpenViewOnce}
      />
    </div>
  )
}

export default function VirtualizedMessageList(props: Props) {
  const { messages, scrollToMessageId, currentUser, onNearTop, ...rowProps } = props
  const listRef = useListRef(null)
  const onNearTopRef = useRef(onNearTop)
  onNearTopRef.current = onNearTop
  // Трекаем границы списка, чтобы отличить append (новое сообщение —
  // можно мотать вниз) от prepend (подгрузка истории — позицию держать).
  const firstIdRef = useRef<string | null>(null)
  const lastIdRef = useRef<string | null>(null)
  const nearBottomRef = useRef(true)

  const rowHeight = useDynamicRowHeight({ defaultRowHeight: DEFAULT_ROW_HEIGHT, key: messages.length })

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    if (messages.length === 0) return
    listRef.current?.scrollToRow({ index: messages.length - 1, align: "end", behavior })
  }, [messages.length, listRef])

  const handleScrollToMessage = useCallback(() => {
    if (!scrollToMessageId || messages.length === 0) return
    const idx = messages.findIndex((m) => m.id === scrollToMessageId)
    if (idx >= 0) listRef.current?.scrollToRow({ index: idx, align: "center" })
  }, [scrollToMessageId, messages, listRef])

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    // Подгрузка истории жила на внешнем div (scrollTop<80), который при
    // виртуализации не скроллится — loadMore не срабатывал вообще.
    if (el.scrollTop < 400) onNearTopRef.current?.()
  }, [])

  // Раньше onRowsRendered дёргал scrollToBottom при каждом рендере —
  // подгрузка старых сообщений тут же прыгала вниз. Теперь мотаем
  // только: первая загрузка чата + новое сообщение, когда юзер и так внизу.
  useEffect(() => {
    if (messages.length === 0) {
      firstIdRef.current = null
      lastIdRef.current = null
      return
    }
    const first = messages[0].id
    const last = messages[messages.length - 1].id
    const prevFirst = firstIdRef.current
    const prevLast = lastIdRef.current
    firstIdRef.current = first
    lastIdRef.current = last
    if (prevFirst === null) {
      scrollToBottom()
    } else if (first === prevFirst && last !== prevLast && nearBottomRef.current) {
      scrollToBottom("smooth")
    }
  }, [messages, scrollToBottom])

  useEffect(() => {
    handleScrollToMessage()
  }, [handleScrollToMessage])

  return (
    <List<RowProps>
      listRef={listRef}
      rowComponent={Row}
      rowProps={{ ...rowProps, messages, currentUser }}
      rowHeight={rowHeight}
      rowCount={messages.length}
      onScroll={handleListScroll}
    />
  )
}
