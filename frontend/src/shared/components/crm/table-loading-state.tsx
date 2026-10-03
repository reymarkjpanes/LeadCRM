import React from 'react';

/** Original Leads column loader, shared by CRM tables. */
export function TableLoadingState({ label }: { label: string }): React.ReactElement {
  return (
    <div role="status" aria-live="polite" className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-8">
      <div className="flex items-center justify-center gap-2 text-[13px] text-[#5A6B85] dark:text-slate-400">
        <div aria-hidden="true" className="w-4 h-4 shrink-0 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        {label}
      </div>
    </div>
  );
}
