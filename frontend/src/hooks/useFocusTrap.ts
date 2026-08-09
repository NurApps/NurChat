import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const current = document.activeElement as HTMLElement;
      const focusArray = Array.from(focusable);
      const currentIndex = focusArray.indexOf(current);

      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          focusArray[focusArray.length - 1].focus();
        }
      } else {
        if (currentIndex >= focusArray.length - 1) {
          e.preventDefault();
          focusArray[0].focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [active]);

  return containerRef;
}

export function useKeyboardNav(listRef: React.RefObject<HTMLElement | null>, options?: {
  onSelect?: (index: number) => void;
  onEscape?: () => void;
  itemCount: number;
}) {
  const currentIndex = useRef(0);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!listRef.current || !options) return;
    const { itemCount, onSelect, onEscape } = options;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        currentIndex.current = Math.min(currentIndex.current + 1, itemCount - 1);
        scrollToIndex(listRef.current, currentIndex.current);
        break;
      case 'ArrowUp':
        e.preventDefault();
        currentIndex.current = Math.max(currentIndex.current - 1, 0);
        scrollToIndex(listRef.current, currentIndex.current);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect?.(currentIndex.current);
        break;
      case 'Escape':
        onEscape?.();
        break;
    }
  }, [listRef, options]);

  return { handleKeyDown, currentIndex: currentIndex.current };
}

function scrollToIndex(container: HTMLElement, index: number) {
  const items = container.querySelectorAll<HTMLElement>('[data-nav-item]');
  items[index]?.scrollIntoView({ block: 'nearest' });
  items[index]?.focus();
}
