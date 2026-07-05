import { useState, useCallback } from "react"

const DEFAULT_PACK = {
  id: "default",
  name: "Стандарт",
  emojis: [
    "👍","❤️","😂","😮","😢","😡","🥳","😎","🤩","🥺",
    "👋","🙌","👏","💪","🎉","🔥","⭐","💯","✅","🙏",
    "💕","💖","💗","💘","💝","😱","🤯","🤡","💀","👻",
    "🐱","🐶","🦊","🐻","🐼","🐸","🐵","🦁","🐯","🦄",
    "🌸","🌺","🌻","🌹","🍀","🌈","☀️","🌙","⭐","✨",
    "🍕","🍔","🍟","🍩","🍪","🎂","🍰","☕","🍺","🍷",
    "⚽","🏀","🎮","🎯","🎨","🎸","🎬","🎤","🎧","🏆",
    "💎","💰","⚖️","🔧","🔨","⚙️","🧲","🗜️","💣","🧨",
  ],
}

const PACKS_KEY = "nurchat_sticker_packs"
const FREQUENT_KEY = "sticker_frequent"
const MAX_FREQUENT = 20

interface StickerPack {
  id: string
  name: string
  emojis: string[]
}

function loadPacks(): StickerPack[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PACKS_KEY) || "[]")
    return stored.filter((p: StickerPack) => p.id !== "default")
  } catch { return [] }
}

function savePacks(packs: StickerPack[]) {
  localStorage.setItem(PACKS_KEY, JSON.stringify(packs))
}

function getFrequentStickers(): string[] {
  try { return JSON.parse(localStorage.getItem(FREQUENT_KEY) || "[]") } catch { return [] }
}

function saveFrequentSticker(sticker: string) {
  const freq = getFrequentStickers().filter((s) => s !== sticker)
  freq.unshift(sticker)
  if (freq.length > MAX_FREQUENT) freq.length = MAX_FREQUENT
  localStorage.setItem(FREQUENT_KEY, JSON.stringify(freq))
}

interface Props {
  onSelect: (sticker: string) => void
}

export default function StickerPicker({ onSelect }: Props) {
  const [packs, setPacks] = useState<StickerPack[]>(loadPacks)
  const [activeTab, setActiveTab] = useState<"frequent" | "default" | string>("frequent")
  const [showCreatePack, setShowCreatePack] = useState(false)
  const [newPackName, setNewPackName] = useState("")
  const [editingPack, setEditingPack] = useState<string | null>(null)

  const allPacks = [DEFAULT_PACK, ...packs]

  const handleSelect = useCallback((sticker: string) => {
    saveFrequentSticker(sticker)
    onSelect(sticker)
  }, [onSelect])

  const handleCreatePack = useCallback(() => {
    if (!newPackName.trim()) return
    const newPack: StickerPack = {
      id: `pack_${Date.now()}`,
      name: newPackName.trim(),
      emojis: [],
    }
    const updated = [...packs, newPack]
    setPacks(updated)
    savePacks(updated)
    setNewPackName("")
    setShowCreatePack(false)
    setActiveTab(newPack.id)
  }, [newPackName, packs])

  const handleDeletePack = useCallback((packId: string) => {
    const updated = packs.filter((p) => p.id !== packId)
    setPacks(updated)
    savePacks(updated)
    setActiveTab("default")
  }, [packs])

  const handleRemoveFromPack = useCallback((packId: string, emoji: string) => {
    const updated = packs.map((p) => {
      if (p.id === packId) {
        return { ...p, emojis: p.emojis.filter((e) => e !== emoji) }
      }
      return p
    })
    setPacks(updated)
    savePacks(updated)
  }, [packs])

  const frequent = getFrequentStickers()
  const activePack = allPacks.find((p) => p.id === activeTab)
  const displayStickers = activeTab === "frequent" ? frequent : activePack?.emojis || []

  return (
    <div className="sticker-picker">
      <div className="sticker-tabs">
        <button className={`sticker-tab ${activeTab === "frequent" ? "active" : ""}`} onClick={() => setActiveTab("frequent")}>⭐</button>
        <button className={`sticker-tab ${activeTab === "default" ? "active" : ""}`} onClick={() => setActiveTab("default")}>📋</button>
        {packs.map((pack) => (
          <button
            key={pack.id}
            className={`sticker-tab ${activeTab === pack.id ? "active" : ""}`}
            onClick={() => setActiveTab(pack.id)}
            onContextMenu={(e) => { e.preventDefault(); setEditingPack(editingPack === pack.id ? null : pack.id) }}
          >
            {pack.name.slice(0, 2)}
          </button>
        ))}
        <button className="sticker-tab" onClick={() => setShowCreatePack(!showCreatePack)}>+</button>
      </div>

      {showCreatePack && (
        <div className="sticker-create-pack">
          <input
            type="text"
            placeholder="Название пака"
            value={newPackName}
            onChange={(e) => setNewPackName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreatePack()}
            autoFocus
          />
          <button className="sticker-create-btn" onClick={handleCreatePack}>Создать</button>
        </div>
      )}

      {editingPack && (
        <div className="sticker-pack-actions">
          <button className="sticker-pack-delete" onClick={() => { handleDeletePack(editingPack); setEditingPack(null) }}>
            Удалить пак
          </button>
          <button className="sticker-pack-cancel" onClick={() => setEditingPack(null)}>Отмена</button>
        </div>
      )}

      <div className="sticker-grid">
        {displayStickers.map((sticker, i) => (
          <div key={`${sticker}-${i}`} className="sticker-btn-wrapper">
            <button className="sticker-btn" onClick={() => handleSelect(sticker)}>
              {sticker}
            </button>
            {editingPack && activePack && (
              <button
                className="sticker-remove-btn"
                onClick={() => handleRemoveFromPack(editingPack, sticker)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {activeTab === "frequent" && frequent.length === 0 && (
          <p className="sticker-empty">Нет часто используемых стикеров</p>
        )}
        {activeTab !== "frequent" && activePack && activePack.emojis.length === 0 && (
          <p className="sticker-empty">Пак пуст. Добавьте стикеры из стандартного набора.</p>
        )}
        {activeTab === "frequent" && frequent.length > 0 && (
          <p className="sticker-hint">Нажмите на стикер, чтобы отправить. Длинное нажатие на вкладку пака — удалить.</p>
        )}
      </div>
    </div>
  )
}
