import { useState, useEffect, type TouchEvent as ReactTouchEvent } from 'react';

interface MobileInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  platform: 'android' | 'ios' | 'web';
  hasNotch: boolean;
  safeAreaInsets: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  orientation: 'portrait' | 'landscape';
  isTouchDevice: boolean;
}

export function useMobile(): MobileInfo {
  const [info, setInfo] = useState<MobileInfo>(() => getMobileInfo());

  useEffect(() => {
    const handleResize = () => {
      setInfo(getMobileInfo());
    };

    const handleOrientationChange = () => {
      // Delay to ensure dimensions are updated
      setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return info;
}

function getMobileInfo(): MobileInfo {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isMobile = width <= 768;
  const isTablet = width > 768 && width <= 1024;
  const isDesktop = width > 1024;

  // Detect platform
  const userAgent = navigator.userAgent.toLowerCase();
  let platform: 'android' | 'ios' | 'web' = 'web';
  if (/android/.test(userAgent)) {
    platform = 'android';
  } else if (/iphone|ipad|ipod/.test(userAgent)) {
    platform = 'ios';
  }

  // Detect notch (iPhone X+ and similar)
  const hasNotch =
    platform === 'ios' &&
    // iPhone X, XS, XR, 11, 12, 13, 14, 15 series
    (height >= 812 || width >= 375) &&
    'ontouchstart' in window;

  // Safe area insets (CSS env vars fallback)
  const safeAreaInsets = {
    top: hasNotch ? 44 : 0,
    bottom: hasNotch ? 34 : 0,
    left: 0,
    right: 0,
  };

  // Try to read actual safe area insets from CSS
  const style = getComputedStyle(document.documentElement);
  const readSafeArea = (value: string): number => {
    const px = parseInt(value, 10);
    return isNaN(px) ? 0 : px;
  };
  safeAreaInsets.top = readSafeArea(style.getPropertyValue('--safe-top')) || safeAreaInsets.top;
  safeAreaInsets.bottom = readSafeArea(style.getPropertyValue('--safe-bottom')) || safeAreaInsets.bottom;

  // Orientation
  const orientation: 'portrait' | 'landscape' = height > width ? 'portrait' : 'landscape';

  // Touch device
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  return {
    isMobile,
    isTablet,
    isDesktop,
    platform,
    hasNotch,
    safeAreaInsets,
    orientation,
    isTouchDevice,
  };
}

// Hook for detecting if running in Tauri
export function useTauri() {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    // Check if running in Tauri
    setIsTauri('__TAURI__' in window);
  }, []);

  return isTauri;
}

// Hook for mobile-specific behaviors
export function useMobileBehavior() {
  const mobile = useMobile();
  const tauri = useTauri();

  // Prevent pull-to-refresh on mobile
  useEffect(() => {
    if (!mobile.isMobile) return;

    const preventPullToRefresh = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.scrollTop <= 0 && e.touches[0].clientY > 0) {
        // Only prevent if at top of scrollable area
        const scrollableParent = target.closest('[style*="overflow"]');
        if (!scrollableParent || (scrollableParent as HTMLElement).scrollTop <= 0) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener('touchmove', preventPullToRefresh, { passive: false });
    return () => document.removeEventListener('touchmove', preventPullToRefresh);
  }, [mobile.isMobile]);

  // Handle virtual keyboard via visualViewport: выставляем --keyboard-height
  // и --viewport-height, чтобы инпут не перекрывался на Android/iOS.
  // Фолбэк для старых браузеров — focusin/scrollIntoView.
  useEffect(() => {
    if (!mobile.isMobile) return;

    const root = document.documentElement;
    const vv = window.visualViewport;

    const update = () => {
      // Высота, съеденная клавиатурой (только положительная часть).
      const keyboardHeight = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      root.style.setProperty('--keyboard-height', `${Math.round(keyboardHeight)}px`);
      root.style.setProperty(
        '--viewport-height',
        `${Math.round(vv ? vv.height : window.innerHeight)}px`,
      );
    };

    const handleFocus = () => {
      // Фолбэк, если visualViewport недоступен.
      if (!vv) {
        setTimeout(() => {
          const activeElement = document.activeElement;
          if (activeElement && activeElement !== document.body) {
            (activeElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
      }
    };

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    document.addEventListener('focusin', handleFocus);

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', handleFocus);
      root.style.setProperty('--keyboard-height', '0px');
      root.style.removeProperty('--viewport-height');
    };
  }, [mobile.isMobile]);

  return {
    ...mobile,
    tauri,
  };
}

/** Короткий haptic-отклик (Android; на iOS/desktop — no-op). */
export function hapticTick(pattern: number | number[] = 10): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

interface SwipeBackHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
}

/**
 * Свайп-назад: старт от левого края (< 40px) + движение вправо (> 80px).
 * Возвращает пропсы для контейнера (напр. .chat-window на мобиле).
 */
export function useSwipeBack(enabled: boolean, onBack: () => void): SwipeBackHandlers {
  const startX = { current: null as number | null };
  const startY = { current: null as number | null };

  return {
    onTouchStart: (e: ReactTouchEvent) => {
      if (!enabled || e.touches.length !== 1) return;
      // Жест только от левого края — иначе конфликтует со скроллом/каруселями.
      if (e.touches[0].clientX > 40) {
        startX.current = null;
        startY.current = null;
        return;
      }
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    },
    onTouchEnd: (e: ReactTouchEvent) => {
      if (!enabled || startX.current === null || startY.current === null) return;
      const end = e.changedTouches[0];
      const dx = end.clientX - startX.current;
      const dy = Math.abs(end.clientY - startY.current);
      startX.current = null;
      startY.current = null;
      // Только явный жест от края, не диагональ и не скролл.
      if (dx > 80 && dy < 60) {
        hapticTick(10);
        onBack();
      }
    },
  };
}
