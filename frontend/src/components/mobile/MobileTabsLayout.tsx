import { useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { BottomTabs } from "./BottomTabs"
import { useChatStore } from "../../store/chatStore"

// Порядок совпадает с порядком кнопок в BottomTabs — от него зависит
// направление анимации (вправо по панели → экран въезжает справа).
function tabIndex(pathname: string): number {
  if (pathname.startsWith("/contacts")) return 0
  if (pathname.startsWith("/calls")) return 1
  if (pathname.startsWith("/settings")) return 3
  return 2
}

// Один экземпляр BottomTabs на все мобильные экраны с нижней навигацией
// (/chat, /calls, /contacts, /settings) — раньше каждая страница монтировала
// свою копию, и при переходе между ними панель пересоздавалась заново
// (и пропадала совсем на страницах, где её забыли добавить).
export default function MobileTabsLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const index = tabIndex(pathname)
  // Направление считаем один раз при смене вкладки и держим в состоянии, чтобы
  // посторонний ререндер (например, счётчик непрочитанных) не обрывал анимацию.
  // key — индекс вкладки, а не путь: /chat → /chat/:id остаётся одним экраном.
  const [nav, setNav] = useState<{ index: number; dir: "none" | "forward" | "back" }>({ index, dir: "none" })
  if (nav.index !== index) setNav({ index, dir: index > nav.index ? "forward" : "back" })
  const chats = useChatStore((s) => s.chats)
  const unreadCount = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  return (
    <>
      <div key={index} className="mobile-tabs-page" data-tab-dir={nav.dir}>
        <Outlet />
      </div>
      <BottomTabs
        onTabChange={(newTab) => {
          if (newTab === "chats") navigate("/chat")
          if (newTab === "settings") navigate("/settings")
          if (newTab === "calls") navigate("/calls")
          if (newTab === "contacts") navigate("/contacts")
        }}
        badges={{ chats: unreadCount }}
      />
    </>
  )
}
