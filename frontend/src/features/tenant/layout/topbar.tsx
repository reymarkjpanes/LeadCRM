'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Menu, Bell, Mail, Search } from 'lucide-react';
import { useNotifications } from '@/features/tenant/notifications/hooks/use-notifications';
import { getGmailStatus, fetchGmailUnreadCount } from '@/features/tenant/inbox/services/gmail.service';
import { useLayout, NAV_ITEMS } from './use-layout';
import { useAuth } from '@/store/AuthContext';
import { usePathname } from 'next/navigation';
import NotificationsDropdown from '@/features/tenant/notifications/ui/notifications-dropdown';
import { GlobalOmnibox } from '@/shared/components/global-omnibox';
import { MobileSearchOverlay } from '@/shared/components/mobile-search-overlay';
import { UserProfileDropdown } from './user-profile-dropdown';
import { cn } from '@/lib/utils';

// -- Types ---------------------------------------------------------------------

interface TopbarProps {
  onOpenSidebar: () => void;
  onOpenInbox: () => void;
  sidebarOpen?: boolean;
}

// -- Component -----------------------------------------------------------------

export default function Topbar({ onOpenSidebar, onOpenInbox, sidebarOpen = false }: TopbarProps): React.ReactElement {
  const { unreadCount: notificationCount } = useNotifications('all', { countsOnly: true });
  const { currentPath } = useLayout();
  const { tenant, user } = useAuth();
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [settingsBreadcrumb, setSettingsBreadcrumb] = useState<{ group: string; tab: string }>({ group: 'General', tab: 'Profile Settings' });
  const notificationButtonRef = useRef<HTMLButtonElement>(null!);



  // Fetch unread email count for inbox badge
  useEffect(() => {
    let isMounted = true;
    const unreadChanged = (event: Event) => { const count = (event as CustomEvent<number>).detail; if (Number.isSafeInteger(count) && count >= 0) setInboxCount(count); };
    window.addEventListener('mailbox-unread-change', unreadChanged);
    getGmailStatus()
      .then((status) => {
        if (status.isConnected) {
          return fetchGmailUnreadCount();
        }
        return null;
      })
      .then((result) => {
        if (isMounted && result) {
          setInboxCount(result.unreadCount);
        }
      })
      .catch(() => { /* silently ignore � Gmail may not be connected */ });

    return () => { isMounted = false; window.removeEventListener('mailbox-unread-change', unreadChanged); };
  }, []);

  // Listen for settings tab changes to update breadcrumb
  useEffect(() => {
    const handleSettingsTab = (e: Event) => {
      const detail = (e as CustomEvent<{ group: string; tab: string }>).detail;
      if (detail) setSettingsBreadcrumb(detail);
    };
    window.addEventListener('settings-tab-change', handleSettingsTab);
    return () => window.removeEventListener('settings-tab-change', handleSettingsTab);
  }, []);

  // Get current module name from navigation
  const isImportPage = pathname?.includes('/import');
  const currentModule = currentPath === 'settings'
    ? settingsBreadcrumb.tab
    : NAV_ITEMS.find(item => item.path === currentPath)?.name ||
        (currentPath === 'help' ? 'Help Center' :
         currentPath === 'notifications' ? 'Notifications' :
         currentPath === 'inbox' ? 'Messages' :
         currentPath === 'profile-settings' ? 'Profile Settings' :
         currentPath === 'forms' ? 'Forms' :
         currentPath === 'reports' ? 'Reports' :
         currentPath === 'deals' ? 'Deals' :
         currentPath === 'card-showcase' ? 'Card Showcase' : 'Dashboard');

  // Get parent group for breadcrumb
  const currentGroup = NAV_ITEMS.find(item => item.path === currentPath);
  const groupName = currentPath === 'settings'
    ? settingsBreadcrumb.group
    : (currentGroup as any)?.group ?? ({ 'profile-settings': 'General', forms: 'Marketing', deals: 'CRM', reports: 'Reporting' } as Record<string, string>)[currentPath] ?? '';

  // Sub-page breadcrumb (e.g. "Import" for /crm/leads/import)
  const subPageName = isImportPage ? 'Import' : null;

  return (
    <header className="h-[52px] bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-2 sm:px-4 lg:px-5 shrink-0 sticky top-0 z-40 transition-colors duration-200">
      {/* Left: Mobile hamburger + Mobile search + Breadcrumb */}
      <div className="flex items-center gap-0.5 sm:gap-1 flex-1 min-w-0">
        <button
          type="button"
          className="navigation-menu-trigger text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1.5 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg transition-colors"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          aria-expanded={sidebarOpen}
          aria-controls="crm-navigation"
        >
          <Menu size={18} />
        </button>

        {/* Mobile search trigger — in left group so it stays clearly separate from right icons */}
        <button
          type="button"
          className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
          onClick={() => setIsMobileSearchOpen(true)}
          aria-label="Search"
        >
          <Search size={16} />
        </button>

        {/* Breadcrumb */}
        <div className="hidden lg:flex items-center gap-1.5 text-[13px] min-w-0">
          {groupName && (
            <>
              <span className="text-[var(--text-tertiary)] font-medium">
                {groupName}
              </span>
              <span className="text-[var(--text-tertiary)] opacity-50">
                &gt;
              </span>
            </>
          )}
          <span className={cn('font-semibold truncate', subPageName ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]')}>
            {currentModule}
          </span>
          {subPageName && (
            <>
              <span className="text-[var(--text-tertiary)] opacity-50">
                &gt;
              </span>
              <span className="text-[var(--text-primary)] font-semibold truncate">
                {subPageName}
              </span>
            </>
          )}
        </div>

      </div>

      {/* Center: Global Search Omnibox */}
      <div className="hidden md:flex flex-1 max-w-[460px] mx-4 justify-center">
        <GlobalOmnibox />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5 sm:gap-1.5 flex-none md:flex-1 justify-end">
        {/* Inbox (Gmail) */}
        <button
          onClick={onOpenInbox}
          className={cn(
            'relative w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] rounded-lg flex items-center justify-center transition-colors',
            currentPath === 'inbox'
              ? 'bg-primary/10 text-primary'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]',
          )}
          aria-label="Open Inbox"
          title="Messages"
        >
          <Mail size={16} />
          {inboxCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center leading-none ring-2 ring-[var(--surface)]">
              {inboxCount > 99 ? '99+' : inboxCount}
            </span>
          )}
        </button>

        {/* Notifications */}
        <button
          ref={notificationButtonRef}
          onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
          className={cn(
            'relative w-8 h-8 sm:min-w-[44px] sm:min-h-[44px] rounded-lg flex items-center justify-center transition-colors',
            isNotificationsOpen
              ? 'bg-primary/10 text-primary'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]',
          )}
          aria-label={`Notifications, ${notificationCount} unread`}
          aria-expanded={isNotificationsOpen}
          aria-haspopup="dialog"
          aria-controls="notifications-dropdown"
        >
          <Bell size={16} />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-bold leading-4 text-white">{notificationCount > 99 ? '99+' : notificationCount}</span>
          )}
        </button>



        {/* User Profile Dropdown */}
        <div className="ml-1">
          <UserProfileDropdown />
        </div>
      </div>

      {/* Notifications Dropdown */}
      <NotificationsDropdown
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        triggerRef={notificationButtonRef}
      />

      {/* Mobile Search Overlay � fullscreen search panel for <md viewports */}
      <MobileSearchOverlay
        isOpen={isMobileSearchOpen}
        onClose={() => setIsMobileSearchOpen(false)}
      />
    </header>
  );
}
