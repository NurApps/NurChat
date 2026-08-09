import { useEffect, useCallback } from "react"

interface ShortcutHandlers {
  onSearch?: () => void
  onNewChat?: () => void
  onEscape?: () => void
  onExport?: () => void
  onFindInChat?: () => void
  onJumpToLatest?: () => void
  onPrevChat?: () => void
  onNextChat?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Escape — close modals (always first)
    if (e.key === "Escape") {
      handlers.onEscape?.()
      return
    }

    // Alt+Up/Down — switch chats (no modifier conflict)
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault()
      handlers.onPrevChat?.()
      return
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault()
      handlers.onNextChat?.()
      return
    }

    // Ctrl/Cmd combos
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault()
          handlers.onSearch?.()
          break
        case "n":
          e.preventDefault()
          handlers.onNewChat?.()
          break
        case "e":
          e.preventDefault()
          handlers.onExport?.()
          break
        case "f":
          e.preventDefault()
          handlers.onFindInChat?.()
          break
        case "l":
          e.preventDefault()
          handlers.onJumpToLatest?.()
          break
      }
    }
  }, [handlers])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])
}
