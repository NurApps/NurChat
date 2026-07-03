import { useState, useMemo, useCallback, useEffect } from "react"

const CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  { name: "Частые", icon: "🕐", emojis: [] }, // populated from recent
  { name: "Лица", icon: "😀", emojis: [
    "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘",
    "😗","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡","🤐","🤨","😐","😑",
    "😶","🫥","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
    "🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟",
    "🙁","☹️","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱",
    "😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️","💩",
    "🤡","👹","👺","👻","👽","👾","🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾",
  ]},
  { name: "Жесты", icon: "👋", emojis: [
    "👋","🤚","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘",
    "🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛","🤜","👏","🙌",
    "🫶","👐","🤲","🤝","🙏","💪","🦾","🦿","🦵","🦶","👂","🦻","👃","🧠","🫀","🦷",
    "🦴","👀","👁️","👅","👄","🫦","💋","🩸","💧","💦","💨","🫧","💭","🐵","🙈","🙉",
  ]},
  { name: "Сердца", icon: "❤️", emojis: [
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓",
    "💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐",
    "⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑",
  ]},
  { name: "Животные", icon: "🐶", emojis: [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸",
    "🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺",
    "🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪲","🪳","🦟","🦗","🕷️","🦂",
    "🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋",
  ]},
  { name: "Еда", icon: "🍔", emojis: [
    "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥",
    "🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠",
    "🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭",
    "🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜",
    "🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧",
    "🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯",
  ]},
  { name: "Активности", icon: "⚽", emojis: [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🥅","⛳",
    "🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂",
    "🏋️","🤸","🤺","⛹️","🤾","🏌️","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚵","🚴","🏆",
    "🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪","🤹","🎭","🎨","🎬","🎤","🎧",
    "🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰",
  ]},
  { name: "Путешествия", icon: "✈️", emojis: [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🛵","🏍️",
    "🛺","🚲","🛴","🛹","🛼","🚏","🛣️","🛤️","🛞","⛽","🛞","🚨","🚰","🚥","🚦","🛑",
    "🚧","⚓","🛟","⛵","🛶","🚤","🛳️","⛴️","🛥️","🚢","✈️","🛩️","🛫","🛬","🪂","💺",
    "🚁","🚟","🚠","🚡","🛰️","🚀","🛸","🌍","🌎","🌏","🗺️","🏔️","🌋","🗻","🏕️","🏖️",
    "🏜️","🏝️","🏞️","🏟️","🏛️","🏗️","🧱","🪨","🪵","🛖","🏘️","🏚️","🏠","🏡","🏢","🏣",
  ]},
  { name: "Предметы", icon: "💻", emojis: [
    "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️","🖲️","🕹️","🗜️","💽","💾","💿","📀","📼",
    "📷","📸","📹","🎥","📽️","🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭",
    "⏱️","⏲️","⏰","🕰️","📡","🔋","🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵",
    "💴","💶","💷","🪙","💰","💳","🪪","🧾","💹","✉️","📧","📨","📩","📤","📥","📦",
    "🏷️","🪧","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉",
    "🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","🗄️","📋","📁","📂","🗂️","🗞️","📰","📓",
  ]},
  { name: "Символы", icon: "💜", emojis: [
    "🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","💕","💞","💓","💗","💖","💘","💝",
    "💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊",
    "♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶",
    "🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️",
    "🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳",
    "🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱",
  ]},
]

const RECENT_KEY = "emoji_recent"

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")
  } catch {
    return []
  }
}

function saveRecent(emoji: string) {
  const recent = getRecent().filter((e) => e !== emoji)
  recent.unshift(emoji)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 30)))
}

interface Props {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState("")
  const [recent, setRecent] = useState<string[]>(getRecent)

  const handleSelect = useCallback((emoji: string) => {
    saveRecent(emoji)
    setRecent(getRecent())
    onSelect(emoji)
  }, [onSelect])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(".emoji-picker")) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return CATEGORIES
    const q = search.toLowerCase()
    return CATEGORIES
      .map((cat) => ({
        ...cat,
        emojis: cat.emojis.filter((e) => e.includes(q) || cat.name.toLowerCase().includes(q)),
      }))
      .filter((cat) => cat.emojis.length > 0)
  }, [search])

  const currentEmojis = useMemo(() => {
    if (tab === 0 && !search) return recent
    const cat = filteredCategories[tab] || filteredCategories[0]
    return cat ? cat.emojis : []
  }, [tab, search, filteredCategories, recent])

  return (
    <div className="emoji-picker">
      <div className="emoji-header">
        <input
          className="emoji-search"
          type="text"
          placeholder="Поиск эмодзи..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button className="emoji-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="emoji-tabs">
        {filteredCategories.map((cat, i) => (
          <button
            key={cat.name}
            className={`emoji-tab ${i === tab ? "active" : ""}`}
            onClick={() => { setTab(i); setSearch("") }}
            title={cat.name}
          >
            {cat.icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {currentEmojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            className="emoji-btn"
            onClick={() => handleSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
        {currentEmojis.length === 0 && (
          <p className="emoji-empty">Ничего не найдено</p>
        )}
      </div>
    </div>
  )
}
