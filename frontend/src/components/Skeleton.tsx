interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string
  style?: React.CSSProperties
}

export function Skeleton({ width, height, borderRadius = "6px", style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  )
}

export function ChatListSkeleton() {
  return (
    <div className="skeleton-list">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton-chat-item">
          <Skeleton width={48} height={48} borderRadius="50%" />
          <div className="skeleton-chat-info">
            <Skeleton width="60%" height={14} />
            <Skeleton width="80%" height={12} borderRadius="4px" />
          </div>
          <Skeleton width={40} height={12} borderRadius="4px" />
        </div>
      ))}
    </div>
  )
}

export function MessageListSkeleton() {
  return (
    <div className="skeleton-messages">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`skeleton-msg-row ${i % 3 === 0 ? "mine" : "other"}`}>
          <Skeleton width={32} height={32} borderRadius="50%" />
          <div className="skeleton-msg-bubble">
            <Skeleton width={`${50 + Math.random() * 40}%`} height={14} borderRadius="4px" />
            <Skeleton width={`${30 + Math.random() * 30}%`} height={12} borderRadius="4px" />
          </div>
        </div>
      ))}
    </div>
  )
}
