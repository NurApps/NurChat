import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom"
import { lazy, Suspense, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { ThemeProvider } from "./context/ThemeContext"
import AuthGuard from "./components/AuthGuard"
import ServerBootOverlay from "./components/ServerBootOverlay"
import Onboarding from "./components/Onboarding"
import ErrorBoundary from "./components/ErrorBoundary"
import UpdateBanner from "./components/UpdateBanner"
import MobileTabsLayout from "./components/mobile/MobileTabsLayout"
import { platform } from "./services/platform"
import { RELAY_UNREACHABLE_EVENT, RELAY_RECOVERED_EVENT } from "./services/api"
import { hasSession } from "./services/tokenVault"
import { storedAccount } from "./services/localSession"
import { e2eWorkerService } from "./services/e2eWorkerService"
import { initSecureStorage } from "./services/e2e"
import { setRecordNamespace } from "./services/secureStorage"
import { activeNamespace } from "./services/profiles"
import { useMobile } from "./hooks/useMobile"

import "./styles/mobile.css"

// Неймспейс ключей активного профиля — до любого обращения к
// secureStorage (модуль загружается раньше эффектов и роутов).
setRecordNamespace(activeNamespace())

const LoginPage = lazy(() => import("./pages/LoginPage"))
const ChatPage = lazy(() => import("./pages/ChatPage"))
const CallPage = lazy(() => import("./pages/CallPage"))
const SettingsPage = lazy(() => import("./pages/SettingsPage"))
const CallHistoryPage = lazy(() => import("./pages/CallHistoryPage"))
const BlockedUsersPage = lazy(() => import("./pages/BlockedUsersPage"))


// Чанки страниц грузим заранее, пока приложение простаивает: иначе первое
// открытие настроек ждёт загрузку и разбор ~200 КБ под полноэкранным спиннером.
// (В мобильной раскладке то же делает MobileTabsLayout.)
function preloadPages() {
  void import("./pages/SettingsPage")
  void import("./pages/CallHistoryPage")
  void import("./pages/BlockedUsersPage")
}

function PageLoader() {
  return (
    <div className="auth-loading">
      <div className="spinner" />
    </div>
  )
}

// Session died unrecoverably (refresh rejected/expired WS + REST):
// bounce to login regardless of which screen is mounted.
function AuthExpiredListener() {
  const navigate = useNavigate()
  useEffect(() => {
    const handler = () => navigate("/login", { replace: true })
    window.addEventListener("nurchat:auth-expired", handler)
    return () => window.removeEventListener("nurchat:auth-expired", handler)
  }, [navigate])
  return null
}

// Ключ явного «выбери релей»: ставит ServerBootOverlay после сохранения
// адреса, снимает App при входе. Пока ключа нет и сессии тоже нет, экран
// выбора релея не показываем — LoginPage сам спросит адрес (RelayAddressInput).
const RELAY_SETUP_REQUESTED_KEY = "relay_setup_requested"

export function markRelaySetupRequested(): void {
  try { localStorage.setItem(RELAY_SETUP_REQUESTED_KEY, "1") } catch { /* ignore */ }
}
function clearRelaySetupRequested(): void {
  try { localStorage.removeItem(RELAY_SETUP_REQUESTED_KEY) } catch { /* ignore */ }
}
function relaySetupRequested(): boolean {
  try { return localStorage.getItem(RELAY_SETUP_REQUESTED_KEY) === "1" } catch { return false }
}

function App() {
  const { t } = useTranslation()
  // UX «как в Telegram»: один раз выбрал релей — дальше всегда внутрь
  // (регистрация/чаты). Обрыв сети НЕ выкидывает на экран «Подключение к
  // relay» — поверх рабочего интерфейса горит только плашка «Соединение…».
  // Поэтому оверлей стартует скрытым; виден он лишь когда:
  //  - пользователь явно попросил выбрать релей (кнопка в настройках /
  //    вход без адреса);
  //  - релей пропал после успешного старта И внутри есть сессия — тогда
  //    чатов показать нечем, нужен выбор адреса (сработает только после
  //    перезагрузки; само соединение восстанавливается в фоне).
  const [serverReady, setServerReady] = useState(
    () => !relaySetupRequested() && (!hasSession() || !!storedAccount()),
  )
  const { isMobile } = useMobile()

  useEffect(() => {
    platform.showMainWindow()
  }, [])

  // Вход выполнен (есть сохранённый профиль) — экран выбора релея больше
  // не нужен, снимаем явный запрос.
  useEffect(() => {
    if (serverReady) clearRelaySetupRequested()
  }, [serverReady])

  // Мобильная раскладка предзагружает вкладки сама (MobileTabsLayout).
  useEffect(() => {
    if (isMobile || !serverReady) return
    const idle = window.requestIdleCallback
    if (idle) { const id = idle(preloadPages); return () => window.cancelIdleCallback(id) }
    const id = window.setTimeout(preloadPages, 500)
    return () => window.clearTimeout(id)
  }, [isMobile, serverReady])

  // Relay пропал уже после успешного старта (рестарт/смена quick-tunnel URL).
  // Экран выбора релея показываем ТОЛЬКО когда внутри есть активная сессия —
  // иначе пользователь просто остаётся на месте и видит плашку
  // «Соединение…» (как в Telegram): сокет и REST сами добирают соединение.
  useEffect(() => {
    const handleUnreachable = () => {
      if (hasSession() && storedAccount()) {
        markRelaySetupRequested()
        setServerReady(false)
      }
    }
    const handleRecovered = () => setServerReady(true)
    window.addEventListener(RELAY_UNREACHABLE_EVENT, handleUnreachable)
    window.addEventListener(RELAY_RECOVERED_EVENT, handleRecovered)
    return () => {
      window.removeEventListener(RELAY_UNREACHABLE_EVENT, handleUnreachable)
      window.removeEventListener(RELAY_RECOVERED_EVENT, handleRecovered)
    }
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
        <a href="#main-content" className="skip-link">{t("common.skipToContent")}</a>
        <Onboarding />
        <UpdateBanner />
        {!serverReady && <ServerBootOverlay onReady={() => setServerReady(true)} />}
        <BrowserRouter>
        <AuthExpiredListener />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            
            {isMobile ? (
              <>
                {/* Один смонтированный BottomTabs на все экраны с нижней навигацией —
                    см. MobileTabsLayout. Звонок — экран без неё, остаётся вне layout'а. */}
                <Route element={<MobileTabsLayout />}>
                  <Route path="/chat" element={<AuthGuard><ChatPage /></AuthGuard>} />
                  <Route path="/chat/:chatId" element={<AuthGuard><ChatPage /></AuthGuard>} />
                  <Route path="/calls" element={<AuthGuard><CallHistoryPage /></AuthGuard>} />
                  <Route path="/contacts" element={<AuthGuard><ChatPage /></AuthGuard>} />
                  <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
                  <Route path="/blocked" element={<AuthGuard><BlockedUsersPage /></AuthGuard>} />
                </Route>
                <Route path="/call/:userId/:type" element={<AuthGuard><CallPage /></AuthGuard>} />
                <Route path="/profile" element={<Navigate to="/settings" replace />} />
              </>
            ) : (
              <>
                <Route path="/chat" element={<AuthGuard><ChatPage /></AuthGuard>} />
                <Route path="/call/:userId/:type" element={<AuthGuard><CallPage /></AuthGuard>} />
                <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
                <Route path="/profile" element={<Navigate to="/settings" replace />} />
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
