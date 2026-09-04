'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { cn } from '@/lib/utils';
import { UsersSubTab } from './team-management-users';
import { GroupsSubTab } from './team-management-groups';
import { DomainsSubTab } from './team-management-domains';

type TeamTab = 'Users' | 'Groups' | 'Domains';

// ── TeamManagement ─────────────────────────────────────────────────────────

export function TeamManagement(): React.ReactElement {
  const { user: currentUser } = useAuth();
  const { users, roles } = useData();
  const tenantId = currentUser?.tenantId ?? '';

  const [activeTab, setActiveTab] = useState<TeamTab>('Users');

  // These are computed here and passed down to sub-tabs that need them
  const tenantUsers = useMemo(
    () => users.filter((u) => !u.isArchived && u.tenantId === tenantId),
    [users, tenantId],
  );
  const roleNames = useMemo(() => roles.filter((r) => !r.isArchived).map((r) => r.name), [roles]);

  const tabCounts: Record<TeamTab, number | null> = {
    Users: tenantUsers.length,
    Groups: null,  // loaded inside GroupsSubTab
    Domains: null, // loaded inside DomainsSubTab
  };

  return (
    <div className="max-w-4xl space-y-4">
      {/* Tab strip */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-white/[0.07]">
        {(['Users', 'Groups', 'Domains'] as TeamTab[]).map((tab) => {
          const count = tabCounts[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'relative px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5',
                activeTab === tab
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tab}
              {count !== null && (
                <span className={cn('text-[10px] font-bold', activeTab === tab ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                  {count}
                </span>
              )}
              {activeTab === tab && (
                <motion.div layoutId="team-tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === 'Users' && (
          <motion.div key="users" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <UsersSubTab />
          </motion.div>
        )}
        {activeTab === 'Groups' && (
          <motion.div key="groups" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <GroupsSubTab tenantUsers={tenantUsers} />
          </motion.div>
        )}
        {activeTab === 'Domains' && (
          <motion.div key="domains" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <DomainsSubTab roleNames={roleNames} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
