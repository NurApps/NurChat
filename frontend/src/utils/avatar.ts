// Darkened from the original pastel palette so white avatar initials keep
// WCAG AA contrast (>=4.5:1) against every swatch.
const AVATAR_COLORS = [
  "#eb0000", "#25827c", "#257f94", "#3c8262",
  "#937000", "#b942b9", "#31826e", "#8d7208",
]

export function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
