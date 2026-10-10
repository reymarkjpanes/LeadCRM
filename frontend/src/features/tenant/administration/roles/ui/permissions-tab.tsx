'use client';

import React from 'react';
import { PERMISSION_MODULES, PERMISSION_ACTIONS, PERMISSION_ACTION_LABELS } from '@leadcrm/shared';
import { cn } from '@/lib/utils';

const ACTION_LABELS = PERMISSION_ACTIONS.map(action => PERMISSION_ACTION_LABELS[action]);

/**
 * Static reference table showing all modules and which actions apply.
 * Read-only — no interaction.
 */
export function PermissionsTab(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold text-slate-900 dark:text-white">Permission Reference</h3>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
          Canonical list of modules and which actions can be assigned to a role.
        </p>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <th className="text-left px-4 py-3 text-[11.5px] font-semibold text-slate-600 dark:text-slate-400 min-w-[150px]">Module</th>
              {ACTION_LABELS.map(a => (
                <th key={a} className="text-center px-4 py-3 text-[11.5px] font-semibold text-slate-600 dark:text-slate-400 min-w-[72px]">{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((mod, i) => (
              <tr key={mod.key} className={cn(
                'border-b border-slate-100 dark:border-slate-800/60 last:border-0',
                i % 2 === 0 ? 'bg-white dark:bg-transparent' : 'bg-slate-50/50 dark:bg-slate-800/20',
              )}>
                <td className="px-4 py-2.5 text-[12.5px] font-medium text-slate-800 dark:text-slate-200">{mod.label}</td>
                {PERMISSION_ACTIONS.map(action => (
                  <td key={action} className="text-center px-4 py-2.5">
                    {mod.actions.includes(action) ? (
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
                    ) : (
                      <span className="inline-block w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
