/**
 * Пользовательские темы: набор CSS-переменных поверх базового скина.
 *
 * Кастомный скин ("custom-light"/"custom-dark") не имеет своего CSS-блока:
 * data-theme остаётся базовым ("light"/"dark"), чтобы работали все
 * [data-theme=...]-селекторы, а поверх инлайном кладутся переменные.
 * Производные (алиасы, --accent-rgb, --on-*) вычисляются автоматически,
 * чтобы легаси-компоненты не разъехались.
 */

export type CustomVariant = "light" | "dark"

/** Редактируемые переменные (без префикса --). */
export const CUSTOM_VAR_KEYS = [
  "bg",
  "surface",
  "surfaceVariant",
  "textPrimary",
  "textSecondary",
  "borderColor",
  "inputBg",
  "accent",
  "accentHover",
  "success",
  "warning",
  "error",
  "msgMineBg",
  "cardBg",
] as const

export type CustomVarKey = (typeof CUSTOM_VAR_KEYS)[number]
export type ThemeVars = Record<CustomVarKey, string>

const VAR_TO_CSS: Record<CustomVarKey, string> = {
  bg: "--bg",
  surface: "--surface",
  surfaceVariant: "--surface-variant",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  borderColor: "--border-color",
  inputBg: "--input-bg",
  accent: "--accent",
  accentHover: "--accent-hover",
  success: "--success",
  warning: "--warning",
  error: "--error",
  msgMineBg: "--msg-mine-bg",
  cardBg: "--card-bg",
}

/** Все пропсы, которыми управляет кастомная тема (для полного снятия). */
const MANAGED_PROPS = [
  ...Object.values(VAR_TO_CSS),
  "--hover",
  "--divider",
  "--tg-blue",
  "--tg-green",
  "--text",
  "--border",
  "--danger",
  "--danger-bg",
  "--primary",
  "--surface-alt",
  "--background",
  "--accent-rgb",
  "--on-accent",
  "--on-success",
  "--on-warning",
  "--on-error",
  "--shadow",
]

export const CUSTOM_SKIN_IDS = ["custom-light", "custom-dark"] as const
export type CustomSkinId = (typeof CUSTOM_SKIN_IDS)[number]

export function isCustomSkinId(id: string): id is CustomSkinId {
  return id === "custom-light" || id === "custom-dark"
}

export function customSkinVariant(id: CustomSkinId): CustomVariant {
  return id === "custom-dark" ? "dark" : "light"
}

/** Стартовые значения = стоковые палитры из core.css. */
export const DEFAULT_CUSTOM_VARS: Record<CustomVariant, ThemeVars> = {
  light: {
    bg: "#ffffff",
    surface: "#ffffff",
    surfaceVariant: "#f5f5f5",
    textPrimary: "#000000",
    textSecondary: "#65656a",
    borderColor: "#e0e0e0",
    inputBg: "#ffffff",
    accent: "#0e7cb4",
    accentHover: "#197bb7",
    success: "#3c843b",
    warning: "#a96500",
    error: "#e22622",
    msgMineBg: "#dcf8c6",
    cardBg: "#ffffff",
  },
  dark: {
    bg: "#0d1117",
    surface: "#161b22",
    surfaceVariant: "#21262d",
    textPrimary: "#e6edf3",
    textSecondary: "#98a0a8",
    borderColor: "#30363d",
    inputBg: "#0d1117",
    accent: "#2aabee",
    accentHover: "#58b9f0",
    success: "#4caf50",
    warning: "#ffa726",
    error: "#ef5350",
    msgMineBg: "#1b5e20",
    cardBg: "#161b22",
  },
}

const STORAGE_PREFIX = "theme-custom-"

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)
}

/** Загрузить сохранённую кастомную тему варианта (null — не задана). */
export function loadCustomTheme(variant: CustomVariant): ThemeVars | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + variant)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Record<CustomVarKey, unknown>>
    const vars = { ...DEFAULT_CUSTOM_VARS[variant] }
    let any = false
    for (const key of CUSTOM_VAR_KEYS) {
      if (isHexColor(parsed[key])) {
        vars[key] = (parsed[key] as string).toLowerCase()
        any = true
      }
    }
    return any ? vars : null
  } catch {
    return null
  }
}

export function saveCustomTheme(variant: CustomVariant, vars: ThemeVars): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + variant, JSON.stringify(vars))
  } catch {
    /* ignore */
  }
}

export function resetCustomThemeStorage(variant: CustomVariant): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + variant)
  } catch {
    /* ignore */
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Относительная яркость по WCAG (с линеаризацией каналов). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Светлый ли цвет. Порог подобран так, чтобы стоковые пары воспроизводились:
 *  #0e7cb4 → тёмный (белый текст), #2aabee → светлый (тёмный текст). */
export function isLightColor(hex: string): boolean {
  return relativeLuminance(hex) > 0.25
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Применить кастомные переменные (+производные) инлайном на <html>. */
export function applyCustomTheme(vars: ThemeVars, variant: CustomVariant): void {
  const el = document.documentElement
  const style = el.style
  for (const key of CUSTOM_VAR_KEYS) {
    style.setProperty(VAR_TO_CSS[key], vars[key])
  }
  // Производные и легаси-алиасы — из тех же значений.
  style.setProperty("--hover", vars.surfaceVariant)
  style.setProperty("--divider", vars.borderColor)
  style.setProperty("--tg-blue", vars.accent)
  style.setProperty("--tg-green", vars.success)
  style.setProperty("--text", vars.textPrimary)
  style.setProperty("--border", vars.borderColor)
  style.setProperty("--danger", vars.error)
  style.setProperty("--danger-bg", hexToRgba(vars.error, 0.12))
  style.setProperty("--primary", vars.accent)
  style.setProperty("--surface-alt", vars.surfaceVariant)
  style.setProperty("--background", vars.bg)
  style.setProperty("--accent-rgb", hexToRgb(vars.accent).join(", "))
  // Текст на сплошной заливке: светлый акцент → тёмный текст, тёмный → белый.
  // От варианта не зависит (сток: светлая — белый на #0e7cb4, тёмная — #04121c на #2aabee).
  const onFor = (hex: string) => (isLightColor(hex) ? "#04121c" : "#ffffff")
  style.setProperty("--on-accent", onFor(vars.accent))
  style.setProperty("--on-success", onFor(vars.success))
  style.setProperty("--on-warning", onFor(vars.warning))
  style.setProperty("--on-error", onFor(vars.error))
  style.setProperty(
    "--shadow",
    variant === "dark" ? "0 1px 3px rgba(0, 0, 0, 0.3)" : "0 1px 3px rgba(0, 0, 0, 0.08)",
  )
}

/** Снять инлайн-переменные (возврат к стоковому скину из CSS). */
export function clearCustomTheme(): void {
  const style = document.documentElement.style
  for (const prop of MANAGED_PROPS) {
    style.removeProperty(prop)
  }
}
