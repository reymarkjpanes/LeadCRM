'use client';

import { useId, useState, type ReactNode, type ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RecordSection({ title, count, actions, children, icon: Icon }: {
  title: string; count?: number; actions?: ReactNode; children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
    <div className={cn('flex flex-wrap items-center gap-x-1.5 px-2.5 py-1 sm:gap-x-2 sm:px-3', open && 'border-b border-border/60')}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 sm:gap-2 sm:text-[11px]">
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />}
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
        {count !== undefined && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums sm:text-[10px]">{count}</span>}
      </button>
      {actions}
    </div>
    <div id={id} hidden={!open}>{children}</div>
  </section>;
}
