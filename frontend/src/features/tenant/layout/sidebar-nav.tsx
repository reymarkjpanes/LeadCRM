'use client';

import React, { useMemo } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SidebarNav({
  sidebarOpen,
  onCloseSidebar,
  navigate,
  isCollapsed,
  onToggleCollapse,
}: SidebarNavProps): React.ReactElement {
  const { currentPath, filteredNav } = useLayout();
  const { user } = useAuth();
  const { contacts, deals, organizations } = useData();

  // Record counts for CRM badge display
  const recordCounts = useMemo(() => ({
    leads: contacts.filter(c => !c.isArchived).length,
    // contacts: contacts.filter(c => !c.isArchived).length, // TODO: Implement V2 Contacts count from real API
    accounts: organizations.filter(o => !o.isArchived).length,
    pipeline: deals.filter(d => !d.isArchived).length,
  }), [contacts, deals, organizations]);

  const getBadgeCount = (path: string): number | undefined => {
    const counts: Record<string, number | undefined> = {
      leads: recordCounts.leads,
      contacts: recordCounts.leads, // Contacts shares the same count as leads (same data source)
      accounts: recordCounts.accounts,
      pipeline: recordCounts.pipeline,
    };
    return counts[path];
  };

  return (
    <aside
      className={cn(
        'fixed lg:static inset-y-0 left-0 z-50',
        'bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]',
        'transform transition-all duration-200 ease-in-out',
        'flex flex-col',
        // Mobile: slide in/out
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        // Width
        'w-[220px]',
        isCollapsed && 'lg:w-[56px]',
      )}
    >
      {/* ── Logo area ─────────────────────────────────────────── */}
      <div className={cn(
        'shrink-0 flex items-center border-b border-[var(--sidebar-border)]',
        isCollapsed ? 'lg:justify-center px-2 py-4' : 'justify-between px-4 py-4',
      )}>
        <div
          className={cn('flex items-center gap-2.5', isCollapsed && 'lg:justify-center')}
          title={isCollapsed ? 'LeadCRM' : undefined}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg overflow-hidden shrink-0">
            <img src="/leadcrm_logo.png" alt="LeadCRM" className="h-7 w-7 object-contain" />
          </div>
          {!isCollapsed && (
            <span className="text-[14px] font-bold text-[var(--sidebar-text)] tracking-tight">
              Lead<span className="text-[#3B82F6]">CRM</span>
            </span>
          )}
        </div>

        {/* Mobile close */}
        <button
          className="lg:hidden text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] p-1.5 rounded-md transition-colors"
          onClick={onCloseSidebar}
          aria-label="Close sidebar"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Navigation ────────────────────────────────────────── */}
      <nav className="flex-1 flex flex-col gap-0.5 px-2 py-3 overflow-y-auto custom-scrollbar">
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

          const groupOrder = ['CRM', 'Operations', 'Marketing', 'Automation', 'Billing', 'Administration'];

          // Merge Operations/Marketing/Automation/Billing into "WORKSPACE"
          const mergedGroups: { label: string; items: typeof filteredNav }[] = [];
          const workspaceItems: typeof filteredNav = [];
          const systemItems: typeof filteredNav = [];

          groupOrder.forEach((g) => {
            if (!groups[g]) return;
            if (g === 'CRM') {
              mergedGroups.push({ label: 'CRM', items: groups[g] });
            } else if (['Operations', 'Marketing', 'Automation', 'Billing'].includes(g)) {
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
        {/* Sandbox badge — shown for SANDBOX tenants only, non-collapsed */}
        {!isCollapsed && (user as any)?.tenantStatus === 'SANDBOX' && (
          <div className="px-3 pt-2.5">
            <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2.5 py-1.5">
              <span className="text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
                Demo Workspace
              </span>
              <button
                type="button"
                onClick={() => { navigate('settings'); onCloseSidebar(); }}
                className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                Upgrade
              </button>
            </div>
          </div>
        )}
        {/* User card + Collapse control */}
        <div className="px-3 py-3 flex items-center gap-2">
          {!isCollapsed && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                {`${user?.firstName?.charAt(0) ?? 'U'}${user?.lastName?.charAt(0) ?? ''}`.toUpperCase()}
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
            className={cn(
              'hidden lg:flex items-center justify-center rounded-md text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] transition-all',
              isCollapsed ? 'w-8 h-8 mx-auto' : 'w-7 h-7 shrink-0',
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
      title={isCollapsed ? item.name : undefined}
      className={cn(
        'relative w-full flex items-center rounded-lg text-[12.5px] font-medium transition-all cursor-pointer',
        isCollapsed ? 'lg:justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2',
        isActive
          ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)]'
          : 'text-[var(--sidebar-text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]',
      )}
    >
      {/* 3px left brand bar for active state */}
      {isActive && !isCollapsed && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#3B82F6] rounded-r-full" />
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