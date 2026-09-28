// Фирменный знак NurChat — плоская геометрия в духе GitHub-марка:
// сплошной баббл + буква N негативным пространством. Без градиентов,
// без ИИ-арта: читается от 16px (favicon, трей) до билборда.
// Цвет фиксирован бренд-синим (#2AABEE); вариант `mono` красится
// currentColor для трея/монохромных контекстов.

import { useId } from "react"

export const NURCHAT_BLUE = "#2AABEE"

function LogoMark({ mono = false }: { mono?: boolean }) {
  const maskId = useId()
  const nPath = "M24 20v24M24 20l16 24M40 44V20"
  const bubblePath =
    "M17 6h30a11 11 0 0 1 11 11v21a11 11 0 0 1-11 11H32L19 60l2.4-11H17a11 11 0 0 1-11-11V17A11 11 0 0 1 17 6Z"
  if (mono) {
    // N вырезана маской — знак остаётся цельным в любом цвете контекста.
    return (
      <svg viewBox="0 0 64 64" role="img" aria-label="NurChat" width="100%" height="100%">
        <mask id={maskId}>
          <rect width="64" height="64" fill="#fff" />
          <path d={nPath} stroke="#000" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </mask>
        <path d={bubblePath} fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="NurChat" width="100%" height="100%">
      <path d={bubblePath} fill={NURCHAT_BLUE} />
      <path d={nPath} stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

interface LogoProps {
  size?: number
  /** показать текстовую часть «NurChat» рядом со знаком */
  wordmark?: boolean
  /** монохром (currentColor) — для трея и мелких системных контекстов */
  mono?: boolean
  className?: string
}

export default function Logo({ size = 40, wordmark = false, mono = false, className }: LogoProps) {
  if (!wordmark) {
    return (
      <span className={className} style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
        <LogoMark mono={mono} />
      </span>
    )
  }
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.28 }}>
      <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
        <LogoMark mono={mono} />
      </span>
      <span style={{ fontSize: size * 0.62, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1 }}>
        NurChat
      </span>
    </span>
  )
}
