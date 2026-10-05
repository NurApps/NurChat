import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Phone, Settings, Users } from 'lucide-react';
import { hapticTick } from '../../hooks/useMobile';

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
}

interface BottomTabsProps {
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  badges?: Record<string, number>;
}

// Порядок как в Telegram: Контакты, Звонки, Чаты, Настройки.
// MobileTabsLayout.tabIndex опирается на него для направления анимации.
const defaultTabs: Tab[] = [
  { id: 'contacts', label: 'Контакты', path: '/contacts', icon: <Users size={24} strokeWidth={2} aria-hidden="true" /> },
  { id: 'calls', label: 'Звонки', path: '/calls', icon: <Phone size={24} strokeWidth={2} aria-hidden="true" /> },
  { id: 'chats', label: 'Чаты', path: '/', icon: <MessageCircle size={24} strokeWidth={2} aria-hidden="true" /> },
  { id: 'settings', label: 'Настройки', path: '/settings', icon: <Settings size={24} strokeWidth={2} aria-hidden="true" /> },
];

export function BottomTabs({ tabs = defaultTabs, activeTab, onTabChange, badges = {} }: BottomTabsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = useCallback(
    (tab: Tab) => {
      if (activeTab) return tab.id === activeTab;
      if (tab.path === '/') return location.pathname === '/' || location.pathname.startsWith('/chat');
      return location.pathname.startsWith(tab.path);
    },
    [activeTab, location.pathname]
  );

  const activeIndex = tabs.findIndex(isActive);

  return (
    <nav
      className="app-bottom-nav"
      style={{ '--tab-count': tabs.length, '--tab-index': Math.max(activeIndex, 0) } as React.CSSProperties}
    >
      {/* Скользящая подсветка активной вкладки: переезжает между пунктами. */}
      {activeIndex >= 0 && <span className="bottom-nav__indicator" aria-hidden="true" />}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`bottom-nav__item ${isActive(tab) ? 'bottom-nav__item--active' : ''}`}
          onClick={() => {
            hapticTick(10)
            if (onTabChange) onTabChange(tab.id)
            else navigate(tab.path)
          }}
          aria-label={tab.label}
          aria-current={isActive(tab) ? 'page' : undefined}
        >
          <span className="bottom-nav__icon">{tab.icon}</span>
          <span>{tab.label}</span>
          {(badges[tab.id] ?? tab.badge) > 0 && (
            <span className="bottom-nav__badge">{(badges[tab.id] ?? tab.badge) > 99 ? '99+' : badges[tab.id] ?? tab.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
