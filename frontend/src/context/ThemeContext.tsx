import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { withViewTransition } from "../utils/viewTransition"
import {
  applyCustomTheme,
  clearCustomTheme,
  customSkinVariant,
  isCustomSkinId,
  loadCustomTheme,
  resetCustomThemeStorage,
  saveCustomTheme,
  type CustomVariant,
  type ThemeVars,
} from "../services/customTheme"

// "Skin" — конкретная палитра. У каждого скина есть вариант (light/dark),
// который определяет, в каком режиме (день/ночь) он доступен для выбора.
export const THEMES = [
  { id: "light", label: "Светлая", variant: "light" },
  { id: "nord", label: "Nord", variant: "light" },
  { id: "custom-light", label: "Своя", variant: "light" },
  { id: "dark", label: "Тёмная", variant: "dark" },
  { id: "dracula", label: "Dracula", variant: "dark" },
  { id: "custom-dark", label: "Своя", variant: "dark" },
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
  /** Пользовательские палитры (null — не задана, берётся сток). */
  customLight: ThemeVars | null
  customDark: ThemeVars | null
  setCustomTheme: (variant: CustomVariant, vars: ThemeVars) => void
  resetCustomTheme: (variant: CustomVariant) => void
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
  customLight: null,
  customDark: null,
  setCustomTheme: () => {},
  resetCustomTheme: () => {},
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initial = readInitial()
  const [mode, setModeState] = useState<ThemeMode>(initial.mode)
  const [lightTheme, setLightThemeState] = useState<Theme>(initial.lightTheme)
  const [darkTheme, setDarkThemeState] = useState<Theme>(initial.darkTheme)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [customLight, setCustomLightState] = useState<ThemeVars | null>(() => loadCustomTheme("light"))
  const [customDark, setCustomDarkState] = useState<ThemeVars | null>(() => loadCustomTheme("dark"))

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
    // Кастомный скин: data-theme остаётся базовым (все [data-theme=...]
    // селекторы работают), палитра кладётся инлайном поверх.
    if (isCustomSkinId(theme)) {
      document.documentElement.setAttribute("data-theme", customSkinVariant(theme))
      const vars = theme === "custom-dark" ? customDark : customLight
      if (vars) applyCustomTheme(vars, customSkinVariant(theme))
      else clearCustomTheme()
    } else {
      document.documentElement.setAttribute("data-theme", theme)
      clearCustomTheme()
    }
  }, [theme, customLight, customDark])

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode)
    localStorage.setItem(LIGHT_SKIN_KEY, lightTheme)
    localStorage.setItem(DARK_SKIN_KEY, darkTheme)
    localStorage.removeItem(LEGACY_KEY)
  }, [mode, lightTheme, darkTheme])

  const setMode = (m: ThemeMode) => withViewTransition(() => setModeState(m))
  const setLightTheme = (t: Theme) => withViewTransition(() => setLightThemeState(t))
  const setDarkTheme = (t: Theme) => withViewTransition(() => setDarkThemeState(t))

  const setCustomTheme = (v: CustomVariant, vars: ThemeVars) => {
    saveCustomTheme(v, vars)
    withViewTransition(() => (v === "dark" ? setCustomDarkState(vars) : setCustomLightState(vars)))
  }
  const resetCustomTheme = (v: CustomVariant) => {
    resetCustomThemeStorage(v)
    withViewTransition(() => (v === "dark" ? setCustomDarkState(null) : setCustomLightState(null)))
  }

  const toggle = () => {
    const next: ThemeMode = variant === "dark" ? "light" : "dark"
    setMode(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, variant, mode, setMode, lightTheme, darkTheme, setLightTheme, setDarkTheme, toggle, customLight, customDark, setCustomTheme, resetCustomTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
