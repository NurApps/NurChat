import { identiconData, identiconColors } from "../utils/identicon"

interface IdenticonProps {
  seed: string
  className?: string
  label?: string
}

// Квадрат 5x5, левая половина + зеркало (как GitHub-identicons).
// className задаёт размер: в кругах аватарок — .identicon-cover.
export default function Identicon({ seed, className, label }: IdenticonProps) {
  const { hue, cells } = identiconData(seed)
  const { fg, bg } = identiconColors(hue)
  const rects: { x: number; y: number }[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (!cells[row * 3 + col]) continue
      rects.push({ x: col, y: row })
      if (col < 2) rects.push({ x: 4 - col, y: row })
    }
  }
  return (
    <svg viewBox="0 0 5 5" className={className} role="img" aria-label={label ?? "avatar"} shapeRendering="crispEdges" preserveAspectRatio="xMidYMid slice">
      <rect width="5" height="5" fill={bg} />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width="1" height="1" fill={fg} />
      ))}
    </svg>
  )
}
