import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

// "Skin" — конкретная палитра. У каждого скина есть вариант (light/dark),
// который определяет, в каком режиме (день/ночь) он доступен для выбора.
export const THEMES = [
  { id: "light", label: "Светлая", variant: "light" },
  { id: "nord", label: "Nord", variant: "light" },
  { id: "dark", label: "Тёмная", variant: "dark" },
  { id: "dracula", label: "Dracula", variant: "dark" },
] as const

export type Theme = (typeof THEMES)[number]["id"]
export type ThemeVariant = "light" | "dark"
export type ThemeMode = "light" | "dark" | "system"

export const LIGHT_THEMES = THEMES.filter((t) => t.variant === "light")
export const DARK_THEMES = THEMES.filter((t) => t.variant === "dark")

const MODE_KEY = "theme-mode"
const LIGHT_SKIN_KEY = "theme-light-skin"
const DARK_SKIN_KEY = "theme-dark-skin"
const LEGACY_KEY = "theme"

function isTheme(v: unknown): v is Theme {
  return THEMES.some((t) => t.id === v)
}

function variantOf(theme: Theme): ThemeVariant {
  return THEMES.find((t) => t.id === theme)!.variant
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

interface ThemeCtx {
  /** Реально применённый скин (то, что стоит в data-theme). */
  theme: Theme
  variant: ThemeVariant
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  lightTheme: Theme
  darkTheme: Theme
  setLightTheme: (t: Theme) => void
  setDarkTheme: (t: Theme) => void
  /** Быстрый переключатель день/ночь (как кнопка в TopBar Telegram). */
  toggle: () => void
}

export const ThemeContext = createContext<ThemeCtx>({
  theme: "light",
  variant: "light",
  mode: "light",
  setMode: () => {},
  lightTheme: "light",
  darkTheme: "dark",
  setLightTheme: () => {},
  setDarkTheme: () => {},
  toggle: () => {},
})

function readInitial(): { mode: ThemeMode; lightTheme: Theme; darkTheme: Theme } {
  const savedMode = localStorage.getItem(MODE_KEY)
  const savedLight = localStorage.getItem(LIGHT_SKIN_KEY)
  const savedDark = localStorage.getItem(DARK_SKIN_KEY)

  if (savedMode === "light" || savedMode === "dark" || savedMode === "system") {
    return {
      mode: savedMode,
      lightTheme: isTheme(savedLight) && variantOf(savedLight) === "light" ? savedLight : "light",
      darkTheme: isTheme(savedDark) && variantOf(savedDark) === "dark" ? savedDark : "dark",
    }
  }

  // Миграция со старой единой схемы (один ключ "theme" на 4 скина без режима).
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (isTheme(legacy)) {
    const v = variantOf(legacy)
    return {
      mode: v,
      lightTheme: v === "light" ? legacy : "light",
      darkTheme: v === "dark" ? legacy : "dark",
    }
  }

  return { mode: "system", lightTheme: "light", darkTheme: "dark" }
}

/** Плавный переход цветов (аналог "растекания" темы в Telegram), с фолбэком. */
function applyWithTransition(apply: () => void) {
  const anyDoc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (typeof anyDoc.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    anyDoc.startViewTransition(apply)
  } else {
    apply()
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initial = readInitial()
  const [mode, setModeState] = useState<ThemeMode>(initial.mode)
  const [lightTheme, setLightThemeState] = useState<Theme>(initial.lightTheme)
  const [darkTheme, setDarkThemeState] = useState<Theme>(initial.darkTheme)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Живое отслеживание смены системной темы (для mode === "system").
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const variant: ThemeVariant = mode === "system" ? (systemDark ? "dark" : "light") : mode
  const theme: Theme = variant === "dark" ? darkTheme : lightTheme

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode)
    localStorage.setItem(LIGHT_SKIN_KEY, lightTheme)
    localStorage.setItem(DARK_SKIN_KEY, darkTheme)
    localStorage.removeItem(LEGACY_KEY)
  }, [mode, lightTheme, darkTheme])

  const setMode = (m: ThemeMode) => applyWithTransition(() => setModeState(m))
  const setLightTheme = (t: Theme) => applyWithTransition(() => setLightThemeState(t))
  const setDarkTheme = (t: Theme) => applyWithTransition(() => setDarkThemeState(t))

  const toggle = () => {
    const next: ThemeMode = variant === "dark" ? "light" : "dark"
    setMode(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, variant, mode, setMode, lightTheme, darkTheme, setLightTheme, setDarkTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
