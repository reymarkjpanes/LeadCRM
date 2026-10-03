'use client';

import React from 'react';
import { X, Lock, Shield, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoleDetail } from '@/store/types/roles.types';
import { PermissionMatrix } from './permission-matrix';

interface RoleDetailDrawerProps {
  role:    RoleDetail | null;
  isOpen:  boolean;
  onClose: () => void;
}

function buildPermissionsMap(role: RoleDetail): Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> {
  const map: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {};
  for (const p of role.permissions) {
    map[p.module] = { ...p };
  }
  return map;
}

export function RoleDetailDrawer({ role, isOpen, onClose }: RoleDetailDrawerProps): React.ReactElement {
  return (
    <>
      {/* Backdrop */}
      {isOpen && <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50" onClick={onClose} />}

      {/* Drawer */}
      <div className={cn(
        'fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white dark:bg-slate-900',
        'border-l border-slate-200 dark:border-slate-700 shadow-2xl',
        'flex flex-col transition-transform duration-200',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          {role && (
            <div className="flex items-center gap-2.5">
              <div className={cn(
                'p-2 rounded-lg',
                role.isSystemRole
                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                  : 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400',
              )}>
                {role.isSystemRole ? <Lock size={14} /> : <Shield size={14} />}
              </div>
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">{role.name}</h2>
                {role.description && (
                  <p className="text-[11.5px] text-slate-500 dark:text-slate-400">{role.description}</p>
                )}
              </div>
              {role.isSystemRole && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  System
                </span>
              )}
            </div>
          )}
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {role && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {/* Permission Matrix — read-only */}
            <div>
              <h3 className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">Permissions</h3>
              {role.isSystemRole && (
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-3">
                  System roles cannot be modified.
                </p>
              )}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
                <PermissionMatrix value={buildPermissionsMap(role)} readOnly />
              </div>
            </div>

            {/* Assigned users */}
            <div>
              <h3 className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">
                Assigned Users ({role.userCount})
              </h3>
              {role.assignedUsers.length === 0 ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-400 dark:text-slate-500 py-3">
                  <Users size={14} />
                  No users assigned to this role
                </div>
              ) : (
                <div className="space-y-2">
                  {role.assignedUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                      <div className="w-8 h-8 rounded-full bg-blue-500 dark:bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {u.firstName[0]}{u.lastName[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-slate-900 dark:text-white truncate">{u.firstName} {u.lastName}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
