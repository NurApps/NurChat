const DRAFTS_KEY = "nurchat_drafts"

function getDraft(chatId: string): string {
  try { return (JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>)[chatId] || "" } catch { return "" }
}

function saveDraft(chatId: string, text: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") as Record<string, string>
    if (text) drafts[chatId] = text; else delete drafts[chatId]
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch { /* ignore */ }
}

function removeDraft(chatId: string) { saveDraft(chatId, "") }

function getDraftForChat(chatId: string): string { return getDraft(chatId) }

export { getDraft, saveDraft, removeDraft, getDraftForChat }
