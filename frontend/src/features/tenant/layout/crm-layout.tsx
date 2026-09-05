'use client';

import React, { useState, useEffect, useRef } from 'react';
import SidebarNav from './sidebar-nav';
import Topbar from './topbar';
import { useLayout } from './use-layout';
import { useAuth } from '@/store/AuthContext';
import { PaymentFailureBanner } from '@/shared/components/payment-failure-banner';

const SIDEBAR_COLLAPSED_KEY = 'leadcrm_sidebar_collapsed';

/**
 * CrmLayout — tenant portal shell.
 * Composes sidebar, topbar, and content area.
 * Navigation items and permissions are owned by `use-layout.ts`.
 * Dark mode is scoped to this container via [data-theme-container] so
 * public pages (login, landing, onboarding) always render in light mode.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { navigate } = useLayout();
  const { user } = useAuth();

  // Billing state — subscriptionStatus comes from /auth/me response (Task 4a)
  // null-safe: defaults to 'ACTIVE' so the banner is never shown for normal/new sessions
  const subscriptionStatus = user?.subscriptionStatus ?? 'ACTIVE';
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);       // mobile overlay open
  const [isCollapsed, setIsCollapsed] = useState(false);       // desktop collapsed
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);

  // Restore collapse preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setIsCollapsed(stored === 'true');
    } catch { /* noop */ }
  }, []);

  // Sync theme to this container on mount (useTheme hook handles updates via themechange event)
  useEffect(() => {
    if (containerRef.current) {
      const saved = localStorage.getItem('app_theme') || 'Light';
      // Remove all theme classes first
      containerRef.current.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');

      if (saved === 'Dark') {
        containerRef.current.classList.add('dark', 'theme-dark');
      } else if (saved === 'Classic') {
        containerRef.current.classList.add('theme-classic');
      } else if (saved === 'System') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          containerRef.current.classList.add('dark', 'theme-dark');
        } else {
          containerRef.current.classList.add('theme-light');
        }
      } else {
        containerRef.current.classList.add('theme-light');
      }
    }

    // Listen for theme changes from useTheme hook
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: string; mode: string }>;
      if (containerRef.current) {
        containerRef.current.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');
        const resolved = customEvent.detail?.theme;
        if (resolved === 'dark') {
          containerRef.current.classList.add('dark', 'theme-dark');
        } else if (resolved === 'classic') {
          containerRef.current.classList.add('theme-classic');
        } else {
          containerRef.current.classList.add('theme-light');
        }
      }
    };

    window.addEventListener('themechange', handleThemeChange);
    return () => window.removeEventListener('themechange', handleThemeChange);
  }, []);

  // Listen for OS preference changes when theme is "System"
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleOsChange = () => {
      // Only respond if current theme is System
      const current = localStorage.getItem('app_theme');
      if (current !== 'System') return;

      if (containerRef.current) {
        containerRef.current.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');
        if (mediaQuery.matches) {
          containerRef.current.classList.add('dark', 'theme-dark');
        } else {
          containerRef.current.classList.add('theme-light');
        }
      }
    };

    mediaQuery.addEventListener('change', handleOsChange);
    return () => mediaQuery.removeEventListener('change', handleOsChange);
  }, []);

  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <div ref={containerRef} data-theme-container className="flex h-screen overflow-hidden bg-[var(--background)] transition-colors duration-200">
      <SidebarNav
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        navigate={navigate}
        isAccountDropdownOpen={isAccountDropdownOpen}
        onToggleAccountDropdown={() => setIsAccountDropdownOpen((prev) => !prev)}
        isCollapsed={isCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenInbox={() => navigate('inbox')}
        />

        {/* Billing state banner — only renders for PAST_DUE, CANCELLED, EXPIRED */}
        <PaymentFailureBanner subscriptionStatus={subscriptionStatus} />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
