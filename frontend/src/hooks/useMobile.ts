import { useState, useEffect } from 'react';

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

  // Handle virtual keyboard
  useEffect(() => {
    if (!mobile.isMobile) return;

    const handleFocus = () => {
      // Scroll input into view when keyboard opens
      setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== document.body) {
          (activeElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    };

    const handleBlur = () => {
      // Reset scroll position when keyboard closes
      window.scrollTo(0, 0);
    };

    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleBlur);

    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleBlur);
    };
  }, [mobile.isMobile]);

  return {
    ...mobile,
    tauri,
  };
}
