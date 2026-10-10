'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeScope } from '@/shared/components/theme-scope';
import { ModuleAccessGuard } from '@/shared/providers/module-access-guard';
import SidebarNav from './sidebar-nav';
import Topbar from './topbar';
import { useLayout } from './use-layout';
import { useAuth } from '@/store/AuthContext';
import { useResponsiveNavigation } from './use-responsive-navigation';

/**
 * CrmLayout — tenant portal shell.
 * Composes sidebar, topbar, and content area.
 * Navigation items and permissions are owned by `use-layout.ts`.
 * Dark mode is scoped to this container via [data-theme-container] so
 * public pages (login, landing, onboarding) always render in light mode.
 */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { navigate } = useLayout();
  const { user, tenant } = useAuth();
  const nav = useResponsiveNavigation(user?.id, tenant?.id);
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const frame = requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector<HTMLElement>('h1') ?? mainRef.current;
      if (target && !target.closest('[inert]')) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <ThemeScope className="crm-shell flex overflow-hidden bg-[var(--background)] transition-colors duration-200">
      <div data-navigation-slot data-collapsed={nav.railCollapsed} data-hidden={nav.focusMode} className="navigation-slot">
      <SidebarNav
        sidebarOpen={nav.drawerOpen}
        onCloseSidebar={nav.closeDrawer}
        navigate={navigate}
        isAccountDropdownOpen={false}
        onToggleAccountDropdown={() => {}}
        isCollapsed={nav.isCollapsed}
        onToggleCollapse={nav.toggleCollapse}
        mode={nav.mode}
        hidden={nav.focusMode}
      />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          onOpenSidebar={nav.openDrawer}
          sidebarOpen={nav.drawerOpen}
          onOpenInbox={() => navigate('inbox')}
        />



        <main key={`${user?.id}`} ref={mainRef} tabIndex={-1} data-app-scroll className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 outline-none">
          <ModuleAccessGuard>{children}</ModuleAccessGuard>
        </main>
      </div>

      {/* Mobile sidebar backdrop */}
      {nav.drawerOpen && (
        <div
          data-overlay-backdrop
          className="fixed inset-0 z-40 bg-black/50"
          onClick={nav.closeDrawer}
          aria-hidden="true"
        />
      )}


    </ThemeScope>
  );
}
