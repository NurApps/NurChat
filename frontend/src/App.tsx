import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense, useState, useEffect } from "react"
import { ThemeProvider } from "./context/ThemeContext"
import AuthGuard from "./components/AuthGuard"
import OfflineBanner from "./components/OfflineBanner"
import ServerBootOverlay from "./components/ServerBootOverlay"
import Onboarding from "./components/Onboarding"
import ErrorBoundary from "./components/ErrorBoundary"
import UpdateBanner from "./components/UpdateBanner"
import { platform } from "./services/platform"
import { e2eWorkerService } from "./services/e2eWorkerService"
import { initSecureStorage } from "./services/secureStorage"

const LoginPage = lazy(() => import("./pages/LoginPage"))
const ChatPage = lazy(() => import("./pages/ChatPage"))
const CallPage = lazy(() => import("./pages/CallPage"))
const SettingsPage = lazy(() => import("./pages/SettingsPage"))
const ProfilePage = lazy(() => import("./pages/ProfilePage"))
const LegalPage = lazy(() => import("./pages/LegalPage"))
const P2PStatusPage = lazy(() => import("./pages/P2PStatusPage"))
const P2PPage = lazy(() => import("./pages/P2PPage"))
const StatsPage = lazy(() => import("./pages/StatsPage"))
const CallHistoryPage = lazy(() => import("./pages/CallHistoryPage"))
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"))
const BackupPage = lazy(() => import("./pages/BackupPage"))
const BlockedUsersPage = lazy(() => import("./pages/BlockedUsersPage"))
const WebhooksPage = lazy(() => import("./pages/WebhooksPage"))

function PageLoader() {
  return (
    <div className="auth-loading">
      <div className="spinner" />
    </div>
  )
}

function App() {
  const [serverReady, setServerReady] = useState(false)

  // Инициализация E2E Web Worker при старте приложения
  // Показываем окно только после загрузки React (убирает белый экран)
  useEffect(() => {
    platform.showMainWindow()
  }, [])

  useEffect(() => {
    const initWorker = async () => {
      try {
        const usingWorker = await e2eWorkerService.init()
        console.log('[App] E2E Worker initialized:', usingWorker ? 'using worker' : 'using main thread fallback')
      } catch (error) {
        console.error('[App] Failed to initialize E2E Worker:', error)
      }
    }

    // Initialize secure storage (migrate from localStorage if needed)
    initSecureStorage().then((result) => {
      if (result.migrated) {
        console.log('[App] Secure storage migration complete')
      }
    }).catch((err) => {
      console.error('[App] Failed to init secure storage:', err)
    })

    initWorker()

    // Очистка при размонтировании
    return () => {
      e2eWorkerService.terminate()
    }
  }, [])

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <a href="#main-content" className="skip-link">Перейти к основному содержимому</a>
        <Onboarding />
        <UpdateBanner />
        {!serverReady && <ServerBootOverlay onReady={() => setServerReady(true)} />}
        <OfflineBanner />
        <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/chat" element={<AuthGuard><ChatPage /></AuthGuard>} />
            <Route path="/call/:userId/:type" element={<AuthGuard><CallPage /></AuthGuard>} />
            <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
            <Route path="/profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
            <Route path="/legal" element={<AuthGuard><LegalPage /></AuthGuard>} />
            <Route path="/p2p" element={<AuthGuard><P2PStatusPage /></AuthGuard>} />
            <Route path="/p2p/connect" element={<AuthGuard><P2PPage /></AuthGuard>} />
            <Route path="/stats" element={<AuthGuard><StatsPage /></AuthGuard>} />
            <Route path="/calls" element={<AuthGuard><CallHistoryPage /></AuthGuard>} />
            <Route path="/audit" element={<AuthGuard><AuditLogPage /></AuthGuard>} />
            <Route path="/backup" element={<AuthGuard><BackupPage /></AuthGuard>} />
            <Route path="/blocked" element={<AuthGuard><BlockedUsersPage /></AuthGuard>} />
            <Route path="/webhooks" element={<AuthGuard><WebhooksPage /></AuthGuard>} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
