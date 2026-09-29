import { useEffect, useRef } from "react"

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script")
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile: api missing")))
      s.onerror = () => {
        scriptPromise = null
        s.remove()
        reject(new Error("turnstile: script load failed"))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

interface Props {
  sitekey: string
  action: string
  theme: "light" | "dark"
  language?: string
  /** Увеличьте, чтобы сбросить виджет: токен одноразовый, после каждой отправки нужен новый. */
  resetSignal: number
  onToken: (token: string) => void
  onError: () => void
}

export default function TurnstileWidget({ sitekey, action, theme, language, resetSignal, onToken, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  })

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !containerRef.current) return
        widgetIdRef.current = ts.render(containerRef.current, {
          sitekey,
          action,
          theme,
          language,
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => {
            onTokenRef.current("")
            onErrorRef.current()
          },
        })
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current()
      })
    return () => {
      cancelled = true
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current)
      widgetIdRef.current = null
      onTokenRef.current("")
    }
  }, [sitekey, action, theme, language])

  useEffect(() => {
    if (resetSignal === 0 || !widgetIdRef.current) return
    window.turnstile?.reset(widgetIdRef.current)
    onTokenRef.current("")
  }, [resetSignal])

  return <div ref={containerRef} className="turnstile-block" />
}
