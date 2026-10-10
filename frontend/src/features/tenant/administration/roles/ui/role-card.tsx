'use client';

import React from 'react';
import { Shield, Users, Lock, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoleListItem } from '@/store/types/roles.types';
import { PERMISSION_MODULES } from '@leadcrm/shared';

interface RoleCardProps {
  role:          RoleListItem;
  canEdit:       boolean;
  canArchive: boolean;
  onEdit:        (role: RoleListItem) => void;
  onArchive:     (role: RoleListItem) => void;
  onViewDetail:  (id: string) => void;
}

export function RoleCard({ role, canEdit, canArchive, onEdit, onArchive, onViewDetail }: RoleCardProps): React.ReactElement {
  // Count how many modules have at least one permission granted
  const activeModules = PERMISSION_MODULES.filter(mod =>
    role.permissions.some(p => p.module === mod.key && (p.canView || p.canCreate || p.canEdit || p.canDelete)),
  ).length;

  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4',
        'hover:border-slate-300 dark:hover:border-slate-700 transition-colors',
        'flex flex-col gap-3 cursor-pointer',
      )}
      onClick={() => onViewDetail(role.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onViewDetail(role.id)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'flex-shrink-0 p-2 rounded-lg',
            role.isSystemRole
              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
              : 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400',
          )}>
            {role.isSystemRole ? <Lock size={14} /> : <Shield size={14} />}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{role.name}</p>
            {role.description && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{role.description}</p>
            )}
          </div>
        </div>
        {role.isSystemRole && (
          <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
            System
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-[11.5px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <Users size={12} />
          {role.userCount} user{role.userCount !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Shield size={12} />
          {activeModules} module{activeModules !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions — only for custom roles when canEdit */}
      {!role.isSystemRole && (canEdit || canArchive) && (
        <div
          className="flex items-center gap-1 pt-2 border-t border-slate-100 dark:border-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={!canEdit}
            onClick={(e) => { e.stopPropagation(); onEdit(role); }}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Pencil size={11} />
            Edit
          </button>
          <button
            type="button"
            disabled={!canArchive}
            onClick={(e) => { e.stopPropagation(); onArchive(role); }}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 size={11} />
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
