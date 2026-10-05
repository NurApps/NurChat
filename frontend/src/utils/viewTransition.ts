export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown }
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update()
    return
  }
  doc.startViewTransition(update)
}

export function viewTransitionName(prefix: string, id: string) {
  return `nurchat-${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}
