import { Outlet, useNavigate } from "react-router-dom"
import { BottomTabs } from "./BottomTabs"
import { useChatStore } from "../../store/chatStore"

// Один экземпляр BottomTabs на все мобильные экраны с нижней навигацией
// (/chat, /calls, /contacts, /settings) — раньше каждая страница монтировала
// свою копию, и при переходе между ними панель пересоздавалась заново
// (и пропадала совсем на страницах, где её забыли добавить).
export default function MobileTabsLayout() {
  const navigate = useNavigate()
  const chats = useChatStore((s) => s.chats)
  const unreadCount = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  return (
    <>
      <div className="mobile-tabs-page">
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
