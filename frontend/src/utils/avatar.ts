// Darkened from the original pastel palette so white avatar initials keep
// WCAG AA contrast (>=4.5:1) against every swatch.
const AVATAR_COLORS = [
  "#eb0000", "#25827c", "#257f94", "#3c8262",
  "#937000", "#b942b9", "#31826e", "#8d7208",
]

// Ключ ОБЯЗАН быть стабильным id пользователя (user.id / chat.id для ЛС),
// а не отображаемым именем: имя меняется и разнится по местам (username vs
// first_name), из-за чего один и тот же человек светился разными цветами
// в списке чатов, сообщениях и настройках группы.
export function getAvatarColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
