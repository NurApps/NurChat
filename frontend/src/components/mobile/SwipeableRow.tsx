import { useState, useCallback, useRef } from 'react';
import type { TouchEvent } from 'react';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete?: () => void;
  onArchive?: () => void;
  onPin?: () => void;
  onMute?: () => void;
  threshold?: number;
}

export function SwipeableRow({
  children,
  onDelete,
  onArchive,
  onPin,
  onMute,
  threshold = 80,
}: SwipeableRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isSwiping) return;

      const deltaX = e.touches[0].clientX - startX.current;
      const deltaY = e.touches[0].clientY - startY.current;

      // Determine swipe direction on first significant move
      if (isHorizontalSwipe.current === null) {
        if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
          isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY);
        }
        return;
      }

      if (!isHorizontalSwipe.current) return;

      // Only allow left swipe (negative deltaX)
      const newOffset = Math.min(0, deltaX);
      setOffsetX(newOffset);
    },
    [isSwiping]
  );

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false);

    if (offsetX < -threshold) {
      // Trigger action based on which button is revealed
      if (onDelete && offsetX < -threshold * 2) {
        onDelete();
      } else if (onArchive && offsetX < -threshold * 1.5) {
        onArchive();
      } else if (onPin) {
        onPin();
      }
    }

    // Snap back
    setOffsetX(0);
    isHorizontalSwipe.current = null;
  }, [offsetX, threshold, onDelete, onArchive, onPin]);

  return (
    <div className="swipeable" style={{ touchAction: 'pan-y' }}>
      <div
        className="swipeable__content"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
      <div className="swipeable__actions">
        {onMute && (
          <div className="swipeable__action swipeable__action--mute">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 5.64a9 9 0 1 1-12.73 0" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </div>
        )}
        {onPin && (
          <div className="swipeable__action swipeable__action--pin">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L12 22M12 2L8 6M12 2L16 6" />
            </svg>
          </div>
        )}
        {onArchive && (
          <div className="swipeable__action swipeable__action--archive">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </div>
        )}
        {onDelete && (
          <div className="swipeable__action swipeable__action--delete">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
