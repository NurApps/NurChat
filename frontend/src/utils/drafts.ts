const DRAFTS_KEY = "nurchat_drafts"

type DraftListener = (chatId: string) => void
const listeners = new Set<DraftListener>()

function getDraft(chatId: string): string {
  try { return (JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>)[chatId] || "" } catch { return "" }
}

function saveDraft(chatId: string, text: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>
    if (text) drafts[chatId] = text; else delete drafts[chatId]
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch { /* ignore */ }
  listeners.forEach((fn) => fn(chatId))
}

function removeDraft(chatId: string) { saveDraft(chatId, "") }

function getDraftForChat(chatId: string): string { return getDraft(chatId) }

/** Подписка на изменения черновика конкретного чата — чтобы превью в списке чатов
 *  обновлялось вживую, а не только при перемонтировании ChatListItem. */
function subscribeDrafts(listener: DraftListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export { getDraft, saveDraft, removeDraft, getDraftForChat, subscribeDrafts }
