'use client';

import { Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

/** Original Leads filter toggle. */
export function FilterButton({ title, open, active, onClick }: { title: string; open?: boolean; active?: boolean; onClick?: () => void }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <button type="button" onClick={onClick} aria-label={`Filter ${title}`} aria-expanded={open} title={`Filter ${title}`}
      className={cn('inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-semibold rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        (open || active) ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-slate-800 text-[#5A6B85] dark:text-slate-300 border-[#E4E9F0] dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700')}>
      <Filter size={13} aria-hidden="true" />Filter
    </button>
  </TooltipTrigger><TooltipContent>Filter {title}</TooltipContent></Tooltip></TooltipProvider>;
}
