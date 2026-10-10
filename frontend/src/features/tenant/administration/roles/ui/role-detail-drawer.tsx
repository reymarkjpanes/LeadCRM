'use client';
import { panelSurfaceClass, panelHeaderClass, panelTitleClass, panelBodyClass, panelCloseClass } from '@/shared/components/side-panel-styles';

import React from 'react';
import { X, Lock, Shield, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoleDetail } from '@/store/types/roles.types';
import { PermissionMatrix } from './permission-matrix';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';

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
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent showClose={false} aria-label="Role details" className={cn(
        panelSurfaceClass,
        'border-l border-slate-200 dark:border-slate-700 shadow-2xl',
        'flex flex-col',
      )}>
        {/* Header */}
        <div className={panelHeaderClass + " flex items-start justify-between gap-3"}>
          {role && (
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2.5">
              <div className={cn(
                'p-2 rounded-lg',
                role.isSystemRole
                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                  : 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400',
              )}>
                {role.isSystemRole ? <Lock size={14} /> : <Shield size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className={panelTitleClass}>{role.name}</h2>
                {role.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere]">{role.description}</p>
                )}
              </div>
              {role.isSystemRole && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                  System
                </span>
              )}
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close role details" className={panelCloseClass + " grid place-items-center"}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {role && (
          <div className={panelBodyClass + " space-y-6"}>
            {/* Permission Matrix — read-only */}
            <div>
              <h3 className="text-[12px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">Permissions</h3>
              {role.isSystemRole && (
                <p className="text-sm text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere] mb-3">
                  System roles cannot be modified.
                </p>
              )}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-4 sm:px-4 overflow-x-auto">
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
      </SheetContent>
    </Sheet>
  );
}
