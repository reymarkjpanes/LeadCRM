'use client';

import Link from 'next/link';
import { Check, ChevronDown, Tag } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { RowActionsMenu, type RowActionItem } from '@/shared/components/data-grid/row-actions-menu';

/** Uses the same preview and footer proportions as the Forms gallery. */
export function CustomFieldCard({ title, description, context, kind, status, meta, href, onClick, disabled, actions }: {
  title: string; description: string; kind: 'product' | 'requirements'; status: string; meta: string;
  context?: string; href?: string; onClick?: () => void; disabled?: boolean; actions: RowActionItem[];
}) {
  const preview = <div aria-hidden="true" className="w-24 space-y-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
    <div className="h-2 w-2/3 rounded bg-slate-800 dark:bg-slate-300" />
    {kind === 'product' ? <>
      <div className="flex h-5 items-center justify-between rounded border border-slate-200 px-1 dark:border-slate-700"><div className="h-1.5 w-8 rounded bg-slate-100 dark:bg-slate-700" /><ChevronDown size={9} className="text-slate-400" /></div>
      <div className="flex h-5 items-center gap-1 rounded bg-blue-50 px-1 text-primary dark:bg-blue-950"><Tag size={10} /><div className="h-1.5 w-10 rounded bg-blue-200 dark:bg-primary" /></div>
    </> : <>
      {[true, false].map((checked, index) => <div key={index} className="flex h-4 items-center gap-1.5"><span className={`flex h-3 w-3 items-center justify-center rounded-sm border ${checked ? 'border-primary bg-primary text-white' : 'border-slate-200 dark:border-slate-600'}`}>{checked && <Check size={9} />}</span><div className="h-1.5 flex-1 rounded bg-slate-100 dark:bg-slate-700" /></div>)}
    </>}
    <div className="h-3 rounded bg-primary" />
  </div>;
  const previewClass = 'flex h-36 w-full items-center justify-center bg-slate-50 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:bg-slate-800 dark:hover:bg-slate-800/80';
  const titleClass = 'block max-w-full truncate text-left text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  return <article className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    {href ? <Link href={href} aria-label={`Manage ${title}`} title={description} className={previewClass}>{preview}</Link> : <button type="button" disabled={disabled} onClick={onClick} aria-label={`Manage ${title}`} title={description} className={previewClass}>{preview}</button>}
    <div className="flex items-center justify-between gap-2 p-4">
      <div className="min-w-0">
        <h3>{href ? <Link href={href} className={titleClass} title={title}>{title}</Link> : <button type="button" disabled={disabled} onClick={onClick} className={titleClass} title={title}>{title}</button>}</h3>
        {context && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{context}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><Badge variant={status === 'Enabled' ? 'default' : 'secondary'} className="px-1 py-0 text-[10px] uppercase">{status}</Badge><span>{meta}</span></div>
      </div>
      {actions.length > 0 && <RowActionsMenu label={`${title} actions`} position="right" actions={actions} />}
    </div>
  </article>;
}
