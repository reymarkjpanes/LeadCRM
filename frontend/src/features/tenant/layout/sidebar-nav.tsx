'use client';

import { UserAvatar } from '@/shared/components/user-avatar';
import React, { useId, useMemo, useRef } from 'react';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import type { NavigationMode } from './use-responsive-navigation';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { useModuleCounts } from '@/shared/hooks/use-module-counts';
import { USE_MOCK_DATA } from '@/lib/config';
import { useLayout } from './use-layout';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SidebarNavProps {
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  navigate: (path: string) => void;
  isAccountDropdownOpen: boolean;
  onToggleAccountDropdown: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  mode?: NavigationMode;
  hidden?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SidebarNav({
  sidebarOpen,
  onCloseSidebar,
  navigate,
  isCollapsed,
  onToggleCollapse,
  mode = 'desktop',
  hidden = false,
}: SidebarNavProps): React.ReactElement {
  const { currentPath, filteredNav } = useLayout();
  const { user, tenant } = useAuth();
  const panelRef = useRef<HTMLElement>(null);
  const owner = useId();
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null);
  const inaccessible = hidden || (mode === 'mobile' && !sidebarOpen);
  useModalInteraction({ open: sidebarOpen && !hidden, panelRef, owner, onClose: onCloseSidebar, kind: 'navigation' });

  // ── Badge counts ────────────────────────────────────────────────────────
  // Real-API mode: fetch lightweight counts (page=1&pageSize=1) independently.
  //   Counts are cached 5 min, refreshed on focus. Sidebar never receives full
  //   contact/deal/org arrays — those belong to their own route hooks now.
  // Mock mode: fall back to DataContext arrays (full dataset in memory).
  const { contacts: mockContacts, deals: mockDeals, organizations: mockOrgs } = useData();

  const { counts: apiCounts } = useModuleCounts(
    USE_MOCK_DATA ? [] : ['leads', 'contacts', 'accounts', 'deals'],
  );

  const recordCounts = useMemo(() => {
    if (USE_MOCK_DATA) {
      return {
        leads:    mockContacts.filter((c) => !c.isArchived).length,
        contacts: 0, // The Contacts page has no mock Contact dataset; mockContacts contains Leads.
        accounts: mockOrgs.filter((o) => !o.isArchived).length,
        pipeline: mockDeals.filter((d) => !d.isArchived).length,
      };
    }
    return {
      leads:    apiCounts['leads']    ?? 0,
      contacts: apiCounts['contacts'] ?? 0,
      accounts: apiCounts['accounts'] ?? 0,
      pipeline: apiCounts['deals']    ?? 0,
    };
  }, [apiCounts, mockContacts, mockDeals, mockOrgs]);

  const getBadgeCount = (path: string): number | undefined => {
    const map: Record<string, number | undefined> = {
      leads:    recordCounts.leads    || undefined, // hide 0 — badge renders nothing
      contacts: recordCounts.contacts    || undefined,
      accounts: recordCounts.accounts || undefined,
      pipeline: recordCounts.pipeline || undefined,
    };
    return map[path];
  };

  return (
    <aside
      ref={panelRef}
      id="crm-navigation"
      data-overlay={sidebarOpen}
      data-hidden={hidden}
      role={sidebarOpen ? 'dialog' : undefined}
      aria-modal={sidebarOpen ? true : undefined}
      aria-label="Main navigation"
      aria-hidden={inaccessible ? true : undefined}
      inert={inaccessible}
      tabIndex={sidebarOpen ? -1 : undefined}
      onPointerDown={event => { if (sidebarOpen && event.pointerType === 'touch') swipe.current = { x: event.clientX, y: event.clientY, time: Date.now() }; }}
      onPointerCancel={() => { swipe.current = null; }}
      onPointerUp={event => {
        const start = swipe.current;
        swipe.current = null;
        if (start && start.x - event.clientX > 60 && Math.abs(start.y - event.clientY) < 40 && Date.now() - start.time < 700) onCloseSidebar();
      }}
      className={cn(
        'navigation-sidebar z-50',
        'bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]',
        'transition-[width,transform] duration-200 ease-in-out motion-reduce:transition-none',
        'flex flex-col',
      )}
    >
      {/* ── Logo area ─────────────────────────────────────────── */}
      <div className={cn(
        'shrink-0 flex items-center border-b border-[var(--sidebar-border)]',
        isCollapsed ? 'justify-center px-2 py-4' : 'justify-between px-4 py-4',
      )}>
        <div
          className={cn('flex items-center gap-2.5', isCollapsed && 'justify-center')}
          title={isCollapsed ? (tenant?.name ? `LeadCRM — ${tenant.name}` : 'LeadCRM') : undefined}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg overflow-hidden shrink-0">
            <img src="/leadcrm_logo.png" alt="LeadCRM" className="h-7 w-7 object-contain" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[14px] font-bold text-[var(--sidebar-text)] tracking-tight leading-tight">
                Lead<span className="text-primary">CRM</span>
              </span>
              {tenant?.name && (
                <span className="text-[10px] text-[var(--sidebar-text-muted)] truncate leading-tight max-w-[140px]">
                  {tenant.name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Mobile close */}
        {sidebarOpen && <button
          type="button"
          className="grid min-h-11 min-w-11 place-items-center text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] rounded-md transition-colors"
          onClick={onCloseSidebar}
          aria-label="Close sidebar"
        >
          <X size={16} />
        </button>}
      </div>

      {/* ── Navigation ────────────────────────────────────────── */}
      <nav aria-label="Workspace" className="min-h-0 flex-1 flex flex-col gap-0.5 px-2 py-3 overflow-y-auto custom-scrollbar">
        {(() => {
          const groups: Record<string, typeof filteredNav> = {};
          const ungrouped: typeof filteredNav = [];

          filteredNav.forEach((item) => {
            const group = (item as any).group;
            if (group) {
              if (!groups[group]) groups[group] = [];
              groups[group].push(item);
            } else {
              ungrouped.push(item);
            }
          });

          const groupOrder = ['CRM', 'Operations', 'Marketing', 'Automation', 'Settings'];

          // Merge Operations/Marketing/Automation/Settings into "WORKSPACE"
          const mergedGroups: { label: string; items: typeof filteredNav }[] = [];
          const workspaceItems: typeof filteredNav = [];
          const systemItems: typeof filteredNav = [];

          groupOrder.forEach((g) => {
            if (!groups[g]) return;
            if (g === 'CRM') {
              mergedGroups.push({ label: 'CRM', items: groups[g] });
            } else if (['Operations', 'Marketing', 'Automation', 'Settings'].includes(g)) {
              workspaceItems.push(...groups[g]);
            } else {
              systemItems.push(...groups[g]);
            }
          });

          if (workspaceItems.length > 0) {
            mergedGroups.push({ label: 'WORKSPACE', items: workspaceItems });
          }
          if (systemItems.length > 0) {
            mergedGroups.push({ label: 'SYSTEM', items: systemItems });
          }

          return (
            <>
              {/* Ungrouped (Dashboard) */}
              {ungrouped.map((item) => (
                <NavButton
                  key={item.path + item.name}
                  item={item as any}
                  isActive={currentPath === item.path}
                  isCollapsed={isCollapsed}
                  badgeCount={getBadgeCount(item.path)}
                  onClick={() => { navigate(item.path); onCloseSidebar(); }}
                />
              ))}

              {/* Grouped sections */}
              {mergedGroups.map((group) => (
                <div key={group.label} className="mt-4">
                  {!isCollapsed && (
                    <p className="px-3 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sidebar-group-label)]">
                      {group.label}
                    </p>
                  )}
                  {isCollapsed && (
                    <div className="h-px bg-[var(--sidebar-border)] my-2 mx-2" />
                  )}
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NavButton
                        key={item.path + item.name}
                        item={item as any}
                        isActive={currentPath === item.path}
                        isCollapsed={isCollapsed}
                        badgeCount={getBadgeCount(item.path)}
                        onClick={() => { navigate(item.path); onCloseSidebar(); }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
      </nav>

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--sidebar-border)]">

        {/* User card + Collapse control */}
        <div className={cn('py-3 flex items-center gap-2', isCollapsed ? 'px-1' : 'px-3')}>
          {!isCollapsed && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                <UserAvatar user={user} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold text-[var(--sidebar-text)] truncate leading-tight">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-[10px] text-[var(--sidebar-text-muted)] truncate">
                  {user?.role ?? 'User'}
                </p>
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            type="button"
            className={cn(
              'navigation-collapse items-center justify-center min-h-11 min-w-11 rounded-md text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] transition-colors',
              isCollapsed ? 'mx-auto' : 'shrink-0',
            )}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Nav Button Sub-component ───────────────────────────────────────────────────

interface NavButtonProps {
  item: { name: string; path: string; icon: React.ComponentType<{ className?: string }> };
  isActive: boolean;
  isCollapsed: boolean;
  badgeCount?: number;
  onClick: () => void;
}

function NavButton({ item, isActive, isCollapsed, badgeCount, onClick }: NavButtonProps): React.ReactElement {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={item.name}
      aria-current={isActive ? 'page' : undefined}
      title={isCollapsed ? item.name : undefined}
      className={cn(
        'relative min-h-11 w-full flex items-center rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2',
        isActive
          ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]'
          : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]',
      )}
    >
      {/* 3px left brand bar for active state */}
      {isActive && !isCollapsed && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
      )}

      <Icon className="h-[16px] w-[16px] shrink-0" />

      {!isCollapsed && (
        <>
          <span className="truncate flex-1 text-left">{item.name}</span>
          {badgeCount !== undefined && badgeCount > 0 && (
            <span className="shrink-0 min-w-[20px] h-[18px] px-1 rounded-md bg-[var(--sidebar-badge-bg)] text-[var(--sidebar-badge-text)] text-[10px] font-bold flex items-center justify-center tabular-nums">
              {badgeCount}
            </span>
          )}
        </>
      )}
    </button>
  );
}
