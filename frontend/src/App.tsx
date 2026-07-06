import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ThemeProvider } from "./context/ThemeContext"
import AuthGuard from "./components/AuthGuard"
import LoginPage from "./pages/LoginPage"
import ChatPage from "./pages/ChatPage"
import CallPage from "./pages/CallPage"
import SettingsPage from "./pages/SettingsPage"
import ProfilePage from "./pages/ProfilePage"
import LegalPage from "./pages/LegalPage"
import P2PStatusPage from "./pages/P2PStatusPage"
import StatsPage from "./pages/StatsPage"
import CallHistoryPage from "./pages/CallHistoryPage"
import AuditLogPage from "./pages/AuditLogPage"
import BackupPage from "./pages/BackupPage"

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
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
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
