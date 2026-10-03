'use client';

import { Settings2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

export function ManageColumnsButton({ onClick }: { onClick?: () => void }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <button type="button" onClick={onClick} aria-label="Manage Columns" title="Manage Columns"
      className="inline-flex items-center justify-center h-8 px-2.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500/40">
      <Settings2 size={14} aria-hidden="true" />
    </button>
  </TooltipTrigger><TooltipContent>Manage Columns</TooltipContent></Tooltip></TooltipProvider>;
}
