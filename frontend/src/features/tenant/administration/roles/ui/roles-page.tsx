'use client';

import React, { useState } from 'react';
import { Plus, Search, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useRoles } from '../hooks/use-roles';
import { RoleCard } from './role-card';
import { RoleBuilderModal } from './role-builder-modal';
import { RoleDetailDrawer } from './role-detail-drawer';
import { PermissionsTab } from './permissions-tab';
import type { RoleListItem } from '@/store/types/roles.types';

type Tab = 'roles' | 'permissions';

export default function RolesPage(): React.ReactElement {
  const canManage = useHasPermission('roles.edit'), canCreate = useHasPermission('roles.create'), canArchive = useHasPermission('roles.archive');
  const [activeTab, setActiveTab] = useState<Tab>('roles');

  const {
    isLoading, error,
    searchQuery, setSearchQuery,
    filteredRoles,
    selectedRole, isDetailOpen,
    isBuilderOpen, editingRole,
    openDetail, closeDetail,
    openBuilder, closeBuilder,
    refetch, handleArchive,
  } = useRoles();

  const onArchive = async (role: RoleListItem) => {
    if (!confirm(`Archive role "${role.name}"? Users assigned to this role will lose its permissions.`)) return;
    try {
      await handleArchive(role.id);
      toast.success(`Role "${role.name}" archived`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive role');
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'roles', label: 'Roles' },
    { id: 'permissions', label: 'Permission Reference' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 lg:p-6 space-y-5"
    >
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[17px] font-semibold text-slate-900 dark:text-white">Roles & Permissions</h1>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5">
            Define access levels and assign them to your team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            title="Refresh"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => openBuilder()}
              className="h-9 px-4 flex items-center gap-1.5 text-[13px] font-medium rounded-lg bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              <Plus size={14} />
              New Role
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-[1px] transition-colors ${
              activeTab === t.id
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Roles tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search roles…"
              className="w-full h-9 pl-9 pr-3 text-[13px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            />
          </div>

          {/* Loading skeleton */}
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {/* Error */}
          {!isLoading && error && (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-[13px]">
              <AlertCircle size={14} />
              {error}
              <button type="button" onClick={() => refetch()} className="ml-auto underline text-[12px]">Retry</button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !error && filteredRoles.length === 0 && (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <p className="text-[13px]">
                {searchQuery ? `No roles match "${searchQuery}"` : 'No roles created yet.'}
              </p>
              {canCreate && !searchQuery && (
                <button type="button" onClick={() => openBuilder()} className="mt-3 text-[12px] text-blue-600 dark:text-blue-400 underline">
                  Create your first role
                </button>
              )}
            </div>
          )}

          {/* Role grid */}
          {!isLoading && !error && filteredRoles.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRoles.map(role => (
                <RoleCard
                  key={role.id}
                  role={role}
                  canEdit={canManage}
                  canArchive={canArchive}
                  onEdit={r => openBuilder(r)}
                  onArchive={onArchive}
                  onViewDetail={openDetail}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Permissions reference tab */}
      {activeTab === 'permissions' && <PermissionsTab />}

      {/* Role detail drawer */}
      <RoleDetailDrawer
        role={selectedRole}
        isOpen={isDetailOpen}
        onClose={closeDetail}
      />

      {/* Role builder modal */}
      {isBuilderOpen && (
        <RoleBuilderModal
          isOpen={isBuilderOpen}
          onClose={closeBuilder}
          onSaved={refetch}
          editRole={editingRole}
        />
      )}
    </motion.div>
  );
}
