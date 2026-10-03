'use client';

import { Search } from 'lucide-react';

/** Leads toolbar search, shared with standalone module tables. */
export function ModuleSearchInput({ value, onChange, placeholder, label = placeholder, disabled }: {
  value: string; onChange: (value: string) => void; placeholder: string; label?: string; disabled?: boolean;
}) {
  return <div className="relative w-full min-w-0 sm:flex-none sm:w-auto">
    <input type="text" value={value} onChange={event => onChange(event.target.value)}
      placeholder={placeholder} aria-label={label} disabled={disabled}
      className="h-8 w-full sm:w-48 lg:w-56 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-all" />
    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" aria-hidden="true" />
  </div>;
}
