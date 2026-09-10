import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props {
  children: ReactNode

import { useTranslation } from "react-i18next"

interface Props {
  children: ReactNode
  t: (key: string) => string
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100vh", padding: 32, textAlign: "center", background: "#f9fafb", color: "#111827",
        }}>
          <h1 style={{ fontSize: 48, margin: 0 }}>💥</h1>
          <h2 style={{ margin: "16px 0 8px" }}>Что-то пошло не так</h2>
          <p style={{ color: "#6b7280", margin: "0 0 24px" }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{
            background: "#2563eb", color: "white", border: "none", borderRadius: 8,
            padding: "12px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
          }}>Перезагрузить</button>

          height: "100vh", padding: 32, textAlign: "center", background: "var(--bg, #f9fafb)", color: "var(--text-primary, #111827)",
        }}>
          <h1 style={{ fontSize: 48, margin: 0 }}>💥</h1>
          <h2 style={{ margin: "16px 0 8px" }}>{this.props.t("errors.somethingWentWrong")}</h2>
          <p style={{ color: "var(--text-secondary, #6b7280)", margin: "0 0 24px" }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{
            background: "var(--accent, #2563eb)", color: "white", border: "none", borderRadius: 8,
            padding: "12px 24px", fontSize: 14, cursor: "pointer", fontWeight: 600,
          }}>{this.props.t("errors.reload")}</button>
        </div>
      )
    }
    return this.props.children
  }
}


export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>
}
