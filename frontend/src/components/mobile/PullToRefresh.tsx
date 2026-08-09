import { useState, useCallback, useRef } from 'react';
import type { TouchEvent, ReactNode } from 'react';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

export function PullToRefresh({
  children,
  onRefresh,
  threshold = 60,
  disabled = false,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const isAtTop = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing) return;

      const container = containerRef.current;
      if (container) {
        isAtTop.current = container.scrollTop <= 0;
      }

      if (isAtTop.current) {
        startY.current = e.touches[0].clientY;
      }
    },
    [disabled, isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing || !isAtTop.current) return;

      const deltaY = e.touches[0].clientY - startY.current;

      if (deltaY > 0) {
        // Apply resistance (rubber band effect)
        const resistance = 0.5;
        const distance = deltaY * resistance;
        setPullDistance(distance);

        // Prevent scroll when pulling
        if (distance > 10) {
          e.preventDefault();
        }
      }
    },
    [disabled, isRefreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (disabled || isRefreshing) return;

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }

    setPullDistance(0);
    isAtTop.current = true;
  }, [pullDistance, threshold, onRefresh, disabled, isRefreshing]);

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 360;

  return (
    <div
      ref={containerRef}
      className={`pull-to-refresh ${isRefreshing ? 'pull-to-refresh--active' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {/* Pull indicator */}
      <div
        style={{
          position: 'absolute',
          top: -50,
          left: '50%',
          transform: `translateX(-50%) translateY(${pullDistance}px)`,
          opacity: progress,
          transition: isRefreshing ? 'none' : 'transform 0.2s ease',
          zIndex: 10,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: `rotate(${isRefreshing ? 360 : rotation}deg)`,
            animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
            color: 'var(--accent-color)',
          }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>

      {/* Content */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isRefreshing ? 'none' : 'transform 0.2s ease',
        }}
      >
        {children}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
