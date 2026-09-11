import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense, useState, useEffect } from "react"
import { ThemeProvider } from "./context/ThemeContext"
import AuthGuard from "./components/AuthGuard"
import ServerBootOverlay from "./components/ServerBootOverlay"
import Onboarding from "./components/Onboarding"
import ErrorBoundary from "./components/ErrorBoundary"
import UpdateBanner from "./components/UpdateBanner"
import { platform } from "./services/platform"
import { e2eWorkerService } from "./services/e2eWorkerService"
import { initSecureStorage } from "./services/e2e"
import { useMobile } from "./hooks/useMobile"

import "./styles/mobile.css"

const LoginPage = lazy(() => import("./pages/LoginPage"))
const ChatPage = lazy(() => import("./pages/ChatPage"))
const CallPage = lazy(() => import("./pages/CallPage"))
const SettingsPage = lazy(() => import("./pages/SettingsPage"))
const ProfilePage = lazy(() => import("./pages/ProfilePage"))
const CallHistoryPage = lazy(() => import("./pages/CallHistoryPage"))
const BlockedUsersPage = lazy(() => import("./pages/BlockedUsersPage"))

const MobileChatPage = lazy(() => import("./pages/MobileChatPage"))

function PageLoader() {
  return (
    <div className="auth-loading">
      <div className="spinner" />
    </div>
  )
}

function App() {
  const [serverReady, setServerReady] = useState(false)
  const { isMobile } = useMobile()

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

    initSecureStorage().then((result) => {
      if (result.migrated) {
        console.log('[App] Secure storage migration complete')
      }
    }).catch((err) => {
      console.error('[App] Failed to init secure storage:', err)
    })

    initWorker()

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
        <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            
            {isMobile ? (
              <>
                <Route path="/chat" element={<AuthGuard><MobileChatPage /></AuthGuard>} />
                <Route path="/chat/:chatId" element={<AuthGuard><MobileChatPage /></AuthGuard>} />
                <Route path="/call/:userId/:type" element={<AuthGuard><CallPage /></AuthGuard>} />
                <Route path="/calls" element={<AuthGuard><MobileChatPage /></AuthGuard>} />
                <Route path="/contacts" element={<AuthGuard><MobileChatPage /></AuthGuard>} />
                <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
              </>
            ) : (
              <>
                <Route path="/chat" element={<AuthGuard><ChatPage /></AuthGuard>} />
                <Route path="/call/:userId/:type" element={<AuthGuard><CallPage /></AuthGuard>} />
                <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
                <Route path="/profile" element={<AuthGuard><ProfilePage /></AuthGuard>} />
                <Route path="/calls" element={<AuthGuard><CallHistoryPage /></AuthGuard>} />
                <Route path="/blocked" element={<AuthGuard><BlockedUsersPage /></AuthGuard>} />
              </>
            )}
            
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
