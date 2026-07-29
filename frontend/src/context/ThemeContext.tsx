import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

export const THEMES = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
  { id: "nord", label: "Nord" },
  { id: "dracula", label: "Dracula" },
] as const

export type Theme = (typeof THEMES)[number]["id"]

interface ThemeCtx {
  theme: Theme
  setTheme: (t: Theme) => void
}

export const ThemeContext = createContext<ThemeCtx>({
  theme: "light",
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme") as Theme | null
    if (saved && THEMES.some((t) => t.id === saved)) return saved
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    return prefersDark ? "dark" : "light"
  })

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("theme", theme)
  }, [theme])

  const setTheme = (t: Theme) => setThemeState(t)

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
