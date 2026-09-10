import { useState, useRef, useCallback, useEffect } from 'react';

interface MobileMediaViewerProps {
  src: string;
  type: 'image' | 'video' | 'audio';
  alt?: string;
  onClose?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}

export function MobileMediaViewer({
  src,
  type,
  alt = '',
  onClose,
  onShare,
  onDelete,
}: MobileMediaViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startDistance, setStartDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle pinch to zoom
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const distance = getDistance(e.touches[0], e.touches[1]);
      setStartDistance(distance);
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      setStartPos({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    }
  }, [position]);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch zoom
        const distance = getDistance(e.touches[0], e.touches[1]);
        const scaleChange = distance / startDistance;
        setScale((prev) => Math.min(Math.max(prev * scaleChange, 0.5), 3));
        setStartDistance(distance);
      } else if (e.touches.length === 1 && isDragging && scale > 1) {
        // Pan when zoomed
        const newX = e.touches[0].clientX - startPos.x;
        const newY = e.touches[0].clientY - startPos.y;
        setPosition({ x: newX, y: newY });
      }
    },
    [isDragging, startPos, scale, startDistance]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);

    // Snap back if zoomed out too far
    if (scale < 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }

    // Reset position if at normal scale
    if (scale <= 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  // Double tap to zoom
  const lastTap = useRef(0);
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // Double tap
      if (scale > 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        setScale(2);
      }
    }
    lastTap.current = now;
  }, [scale]);

  // Reset on new media
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [src]);

  return (
    <div
      ref={containerRef}
      className="mobile-media-viewer"
      onTouchStart={handleTouchStart as any}
      onTouchMove={handleTouchMove as any}
      onTouchEnd={handleTouchEnd as any}
      onClick={handleDoubleTap}
    >
      {/* Header */}
      <div className="mobile-media-viewer__header">
        <button
          className="mobile-media-viewer__close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="mobile-media-viewer__actions">
          {onShare && (
            <button
              className="mobile-media-viewer__action"
              onClick={onShare}
              aria-label="Поделиться"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              className="mobile-media-viewer__action mobile-media-viewer__action--danger"
              onClick={onDelete}
              aria-label="Удалить"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Media content */}
      <div
        className="mobile-media-viewer__content"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
      >
        {type === 'image' && (
          <img
            src={src}
            alt={alt}
            className="mobile-media-viewer__image"
            draggable={false}
          />
        )}
        {type === 'video' && (
          <video
            src={src}
            className="mobile-media-viewer__video"
            controls
            playsInline
            autoPlay
          />
        )}
        {type === 'audio' && (
          <div className="mobile-media-viewer__audio">
            <div className="mobile-media-viewer__audio-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <audio src={src} controls className="mobile-media-viewer__audio-player" />
          </div>
        )}
      </div>

      {/* Zoom indicator */}
      {scale !== 1 && (
        <div className="mobile-media-viewer__zoom">
          {Math.round(scale * 100)}%
        </div>
      )}

      <style>{`
        .mobile-media-viewer {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.95);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          touch-action: none;
          user-select: none;
        }

        .mobile-media-viewer__header {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          padding-top: calc(16px + env(safe-area-inset-top, 0px));
          z-index: 10;
          background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
        }

        .mobile-media-viewer__close,
        .mobile-media-viewer__action {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          backdrop-filter: blur(10px);
        }

        .mobile-media-viewer__action--danger {
          background: rgba(255, 59, 48, 0.6);
        }

        .mobile-media-viewer__actions {
          display: flex;
          gap: 12px;
        }

        .mobile-media-viewer__content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .mobile-media-viewer__image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .mobile-media-viewer__video {
          max-width: 100%;
          max-height: 100%;
        }

        .mobile-media-viewer__audio {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          color: white;
        }

        .mobile-media-viewer__audio-icon {
          opacity: 0.6;
        }

        .mobile-media-viewer__audio-player {
          width: 80vw;
          max-width: 400px;
        }

        .mobile-media-viewer__zoom {
          position: absolute;
          bottom: 100px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.6);
          color: white;
          padding: 6px 12px;
          border-radius: 12px;
          font-size: 14px;
          backdrop-filter: blur(10px);
        }
      `}</style>
    </div>
  );
}

function getDistance(touch1: Touch, touch2: Touch): number {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
