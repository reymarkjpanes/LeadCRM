'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Menu, Bell, Mail } from 'lucide-react';
import { useNotifications } from '@/features/tenant/notifications/hooks/use-notifications';
import { getGmailStatus, fetchGmailEmails } from '@/features/tenant/inbox/services/gmail.service';
import { useLayout, NAV_ITEMS } from './use-layout';
import { useAuth } from '@/store/AuthContext';
import { usePathname } from 'next/navigation';
import NotificationsDropdown from '@/features/tenant/notifications/ui/notifications-dropdown';
import { GlobalOmnibox } from '@/shared/components/global-omnibox';
import { UserProfileDropdown } from './user-profile-dropdown';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopbarProps {
  onOpenSidebar: () => void;
  onOpenInbox: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Topbar({ onOpenSidebar, onOpenInbox }: TopbarProps): React.ReactElement {
  const { unreadCount: notificationCount } = useNotifications();
  const { currentPath } = useLayout();
  const { tenant, user } = useAuth();
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [settingsBreadcrumb, setSettingsBreadcrumb] = useState<{ group: string; tab: string }>({ group: 'General', tab: 'Profile Settings' });
  const notificationButtonRef = useRef<HTMLButtonElement>(null!);

  // isSandbox: derived from server-backed tenantStatus (SANDBOX = pre-subscription).
  // Reads from user.tenantStatus — same source sidebar uses correctly.
  // Never reads tenant.environment which was previously hardcoded to 'production'.
  const isSandbox = (user as any)?.tenantStatus === 'SANDBOX';

  // Fetch unread email count for inbox badge
  useEffect(() => {
    let isMounted = true;
    getGmailStatus()
      .then((status) => {
        if (status.isConnected) {
          return fetchGmailEmails({ maxResults: 30, query: 'in:inbox is:unread' });
        }
        return null;
      })
      .then((result) => {
        if (isMounted && result) {
          setInboxCount(result.emails.length);
        }
      })
      .catch(() => { /* silently ignore — Gmail may not be connected */ });

    return () => { isMounted = false; };
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
  const isBillingPage = currentPath === 'client-billing' || currentPath === 'billing';
  const currentModule = currentPath === 'settings'
    ? settingsBreadcrumb.tab
    : isBillingPage
      ? 'Billing & Subscription'
      : NAV_ITEMS.find(item => item.path === currentPath)?.name ||
        (currentPath === 'notifications' ? 'Notifications' :
         currentPath === 'inbox' ? 'Messages' : 'Dashboard');

  // Get parent group for breadcrumb
  const currentGroup = NAV_ITEMS.find(item => item.path === currentPath);
  const groupName = currentPath === 'settings'
    ? settingsBreadcrumb.group
    : isBillingPage
      ? 'Billing'
      : (currentGroup as any)?.group ?? '';

  // Sub-page breadcrumb (e.g. "Import" for /crm/leads/import)
  const subPageName = isImportPage ? 'Import' : null;

  return (
    <header className="h-[52px] bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-4 lg:px-5 shrink-0 sticky top-0 z-40 transition-colors duration-200">
      {/* Left: Mobile hamburger + Breadcrumb */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <button
          className="lg:hidden text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1.5 rounded-lg transition-colors"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
        >
          <Menu size={18} />
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
      <div className="flex items-center gap-1.5 flex-1 justify-end">
        {/* Inbox (Gmail) */}
        <button
          onClick={onOpenInbox}
          className={cn(
            'relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
            currentPath === 'inbox'
              ? 'bg-[#3B82F6]/10 text-[#3B82F6]'
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
            'relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
            isNotificationsOpen
              ? 'bg-[#3B82F6]/10 text-[#3B82F6]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]',
          )}
          aria-label="Notifications"
          aria-expanded={isNotificationsOpen}
        >
          <Bell size={16} />
          {notificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#3B82F6]" />
          )}
        </button>

        {/* Sandbox Indicator */}
        {isSandbox && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold tracking-wide uppercase"
            title="Sandbox environment — test data only"
            aria-label="Sandbox environment"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            Sandbox
          </span>
        )}

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
    </header>
  );
}
