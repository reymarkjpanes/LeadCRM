'use client';
import { PageHeader } from '@/shared/components/ui/page-header';


import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { cn } from '@/lib/utils';
import { UsersSubTab } from './team-management-users';
import { GroupsSubTab } from './team-management-groups';
import type { User } from '@/store/types';

type TeamTab = 'Users' | 'Groups';

// ── TeamManagement ─────────────────────────────────────────────────────────

export function TeamManagement(): React.ReactElement {
  const { user: currentUser, userCan } = useAuth();
  const { users } = useData();
  const tenantId = currentUser?.tenantId ?? '';

  const canViewUsers = userCan('users', 'canView'), canViewGroups = userCan('groups', 'canView');
  const visibleTabs: TeamTab[] = [...(canViewUsers ? ['Users' as const] : []), ...(canViewGroups ? ['Groups' as const] : [])];
  const [activeTab, setActiveTab] = useState<TeamTab>(canViewUsers ? 'Users' : 'Groups');
  const selectedTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0];
  const [loadedUsers, setLoadedUsers] = useState<User[] | null>(null);
  useEffect(() => { setLoadedUsers(null); }, [tenantId]);
  useEffect(() => { setActiveTab(canViewUsers ? 'Users' : 'Groups'); }, [tenantId, currentUser?.id]);

  // These are computed here and passed down to sub-tabs that need them
  const tenantUsers = useMemo(
    () => (loadedUsers ?? users).filter((u) => !u.isArchived && u.tenantId === tenantId),
    [loadedUsers, users, tenantId],
  );

  const tabCounts: Record<TeamTab, number | null> = {
    Users: loadedUsers === null ? null : tenantUsers.length,
    Groups: null,  // loaded inside GroupsSubTab
  };

  const renderHeader = (action: React.ReactNode) => (
    <>
      <PageHeader title="Team Management" subtitle="Manage users and groups within Camxian Technologies." actions={action} />
      <div className="flex min-w-0 items-center gap-0 border-b border-gray-200 dark:border-white/[0.07]">
        {visibleTabs.map((tab) => {
          const count = tabCounts[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'relative px-2 sm:px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5',
                selectedTab === tab
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tab}
              {count !== null && (
                <span className={cn('text-[10px] font-bold', selectedTab === tab ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                  {count}
                </span>
              )}
              {selectedTab === tab && (
                <motion.div layoutId="team-tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="min-w-0 w-full space-y-4">
      {(!selectedTab || !currentUser) && <PageHeader title="Team Management" subtitle="Manage users and groups within Camxian Technologies." />}
      {!visibleTabs.length && <p role="alert">You do not have permission to view users or groups.</p>}
      {/* Tab content */}
      <AnimatePresence key={`${tenantId}:${currentUser?.id}:${canViewUsers}:${canViewGroups}`} mode="wait">
        {selectedTab === 'Users' && currentUser && (
          <motion.div key={`users:${tenantId}:${currentUser.id}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <UsersSubTab renderHeader={renderHeader} onUsersLoaded={setLoadedUsers} />
          </motion.div>
        )}
        {selectedTab === 'Groups' && currentUser && (
          <motion.div key={`groups:${tenantId}:${currentUser.id}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <GroupsSubTab renderHeader={renderHeader} tenantUsers={tenantUsers} />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
