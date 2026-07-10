import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense, useState } from "react"
import { ThemeProvider } from "./context/ThemeContext"
import AuthGuard from "./components/AuthGuard"
import OfflineBanner from "./components/OfflineBanner"
import ServerBootOverlay from "./components/ServerBootOverlay"

const LoginPage = lazy(() => import("./pages/LoginPage"))
const ChatPage = lazy(() => import("./pages/ChatPage"))
const CallPage = lazy(() => import("./pages/CallPage"))
const SettingsPage = lazy(() => import("./pages/SettingsPage"))
const ProfilePage = lazy(() => import("./pages/ProfilePage"))
const LegalPage = lazy(() => import("./pages/LegalPage"))
const P2PStatusPage = lazy(() => import("./pages/P2PStatusPage"))
const StatsPage = lazy(() => import("./pages/StatsPage"))
const CallHistoryPage = lazy(() => import("./pages/CallHistoryPage"))
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"))
const BackupPage = lazy(() => import("./pages/BackupPage"))
const BlockedUsersPage = lazy(() => import("./pages/BlockedUsersPage"))

function PageLoader() {
  return (
    <div className="auth-loading">
      <div className="spinner" />
    </div>
  )
}

function App() {
  const [serverReady, setServerReady] = useState(false)

  return (
    <ThemeProvider>
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
            <Route path="/stats" element={<AuthGuard><StatsPage /></AuthGuard>} />
            <Route path="/calls" element={<AuthGuard><CallHistoryPage /></AuthGuard>} />
            <Route path="/audit" element={<AuthGuard><AuditLogPage /></AuthGuard>} />
            <Route path="/backup" element={<AuthGuard><BackupPage /></AuthGuard>} />
            <Route path="/blocked" element={<AuthGuard><BlockedUsersPage /></AuthGuard>} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
