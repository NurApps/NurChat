import { useEffect, useCallback } from "react"

interface ShortcutHandlers {
  onSearch?: () => void
  onNewChat?: () => void
  onEscape?: () => void
  onExport?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+K or Cmd+K — search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault()
      handlers.onSearch?.()
    }

    // Ctrl+N or Cmd+N — new chat
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault()
      handlers.onNewChat?.()
    }

    // Ctrl+E or Cmd+E — export
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault()
      handlers.onExport?.()
    }

    // Escape — close modals
    if (e.key === "Escape") {
      handlers.onEscape?.()
    }
  }, [handlers])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])
}
