'use client';

import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { PERMISSION_MODULES, PERMISSION_ACTIONS, PERMISSION_ACTION_LABELS } from '@leadcrm/shared';
import type { PermissionAction, PermissionFlags } from '@/store/types/roles.types';

interface PermissionMatrixProps {
  /** Current permission values: module key → flags */
  value: Record<string, PermissionFlags>;
  /** If true, all cells are non-interactive (read-only view) */
  readOnly?: boolean;
  /** Called when a flag is toggled — only fires when readOnly=false */
  onChange?: (module: string, action: PermissionAction, checked: boolean) => void;
}

const ACTION_LABELS = PERMISSION_ACTION_LABELS;

const ACTIONS = PERMISSION_ACTIONS;

export function PermissionMatrix({ value, readOnly = false, onChange }: PermissionMatrixProps): React.ReactElement {
  const handleToggle = useCallback((module: string, action: PermissionAction, current: boolean) => {
    if (readOnly || !onChange) return;
    const next = !current;
    onChange(module, action, next);
  }, [readOnly, onChange]);

  const getFlag = (module: string, action: PermissionAction): boolean =>
    value[module]?.[action] ?? false;

  const hasAnyActions = (module: string): boolean =>
    ACTIONS.some(a => a !== 'canView' && getFlag(module, a));

  const isViewLocked = (module: string): boolean =>
    !readOnly && hasAnyActions(module);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 pr-4 font-medium text-slate-600 dark:text-slate-400 min-w-[140px]">Module</th>
            {ACTIONS.map(action => (
              <th key={action} className="text-center py-2 px-3 font-medium text-slate-600 dark:text-slate-400 min-w-[72px]">
                {ACTION_LABELS[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MODULES.map((mod) => (
            <tr
              key={mod.key}
              className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
            >
              <td className="py-2.5 pr-4 font-medium text-slate-800 dark:text-slate-200 text-[13px]">
                {mod.label}
              </td>
              {ACTIONS.map(action => {
                const applicable = mod.actions.includes(action);
                const checked    = applicable && getFlag(mod.key, action);
                const locked     = action === 'canView' && isViewLocked(mod.key);
                const interactive = !readOnly && applicable;

                if (!applicable) {
                  return (
                    <td key={action} className="text-center py-2.5 px-3">
                      <span className="inline-block w-5 h-5 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 opacity-40" />
                    </td>
                  );
                }

                return (
                  <td key={action} className="text-center py-2.5 px-3">
                    <button
                      type="button"
                      disabled={!interactive || locked}
                      onClick={() => interactive && !locked && handleToggle(mod.key, action, checked)}
                      className={cn(
                        'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                        checked
                          ? 'bg-primary dark:bg-primary border-primary dark:border-primary text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-transparent',
                        interactive && !locked
                          ? 'cursor-pointer hover:border-primary dark:hover:border-primary'
                          : 'cursor-default opacity-70',
                        locked && 'opacity-60',
                      )}
                      aria-label={`${checked ? 'Disable' : 'Enable'} ${ACTION_LABELS[action]} for ${mod.label}`}
                      title={locked ? 'canView is required when other permissions are active' : undefined}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
