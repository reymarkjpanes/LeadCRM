'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

/** DataGrid quick-action styling with accessible tooltips and disabled states. */
export function TableIconButton({ label, ariaLabel = label, children, onClick, disabled, touchFriendly = false }: {
  label: string; ariaLabel?: string; children: ReactNode; onClick: () => void; disabled?: boolean; touchFriendly?: boolean;
}) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <button type="button" onClick={event => { event.stopPropagation(); onClick(); }} disabled={disabled} aria-label={ariaLabel} title={label}
      className={cn(touchFriendly && 'min-w-11 min-h-11 sm:min-w-0 sm:min-h-0', 'p-1.5 inline-flex shrink-0 items-center justify-center rounded-md transition-colors text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40')}>
      {children}
    </button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>;
}
