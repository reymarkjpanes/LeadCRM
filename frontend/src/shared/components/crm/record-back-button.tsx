'use client';
import { ArrowLeft } from 'lucide-react';

export function RecordBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors mb-3 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <ArrowLeft size={14} className="shrink-0" /> Back to {label}
  </button>;
}
