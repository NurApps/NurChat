import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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

const defaultTabs: Tab[] = [
  {
    id: 'chats',
    label: 'Чаты',
    path: '/',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'calls',
    label: 'Звонки',
    path: '/calls',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
  },
  {
    id: 'contacts',
    label: 'Контакты',
    path: '/contacts',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Настройки',
    path: '/settings',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
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

  return (
    <nav className="app-bottom-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`bottom-nav__item ${isActive(tab) ? 'bottom-nav__item--active' : ''}`}
          onClick={() => {
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
