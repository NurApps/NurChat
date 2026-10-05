import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles/index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: регистрируем SW на проде и только вне Tauri (в Tauri — нативные
// уведомления, а в dev — регистрация мешает HMR из-за кэша).
if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  !(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})
  })
}
