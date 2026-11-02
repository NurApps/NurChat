import { flushSync } from "react-dom"

export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown }
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update()
    return
  }
  // flushSync: снимок «после» делается сразу, как вернулся callback. useState-обновления
  // React применяет позже (и на слабом телефоне — уже после снимка), тогда морфинг теряет
  // вторую половину пары и остаётся простое затухание. Zustand-стор синхронный и без этого.
  doc.startViewTransition(() => flushSync(update))
}

export function viewTransitionName(prefix: string, id: string) {
  return `nurchat-${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}
