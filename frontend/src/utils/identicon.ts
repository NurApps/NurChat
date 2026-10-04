// Детерминированный генератор аватарок в духе GitHub-identicons:
// симметричная геометрия 5x5 + цвет из хэша seed (user/chat id).
// Чистая функция от seed — одинаков на всех устройствах и сессиях,
// без сети и без хранения. Юзер с загруженным фото видит фото;
// это — дефолт вместо буквы.

export interface IdenticonData {
  hue: number
  /** 15 ячеек левой половины (включая центр); правая — зеркало. */
  cells: boolean[]
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function identiconData(seed: string): IdenticonData {
  const rand = mulberry32(fnv1a(seed || "?"))
  const hue = Math.floor(rand() * 360)
  const cells: boolean[] = []
  for (let i = 0; i < 15; i++) cells.push(rand() > 0.52)
  // Пустое поле недопустимо — зажигаем центр (как GitHub: поле не бывает пустым).
  if (!cells.some(Boolean)) cells[7] = true
  return { hue, cells }
}

export function identiconColors(hue: number): { fg: string; bg: string } {
  return {
    fg: `hsl(${hue}, 62%, 44%)`,
    bg: `hsl(${hue}, 32%, 93%)`,
  }
}
