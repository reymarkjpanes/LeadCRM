import React from 'react';
import { StatusBadge } from './record-drawer';
import { CRM_STATUSES, normalizeCrmStatus, CUSTOMER_STATUS_HELP, type CrmStatus } from '@leadcrm/shared';
import { CRM_STATUS_PRESENTATION, getCRMStatusStyles, getCRMStatusStripColor } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';

// Preserve the existing Leads table palette and presentation for both modules.
export const CRM_STATUS_DOT_COLORS = Object.fromEntries(CRM_STATUSES.map(status => [status, CRM_STATUS_PRESENTATION[status].color])) as Record<CrmStatus, string>;

export function CrmStatusIndicator({ status }: { status?: string }) {
  const label = normalizeCrmStatus(status);
  return <span title={CUSTOMER_STATUS_HELP[label]} className="flex items-center gap-1.5 min-w-0">
    <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CRM_STATUS_DOT_COLORS[label] }} />
    <span className="text-[13px] text-[#3C4858] dark:text-slate-300 truncate">{label}</span>
  </span>;
}

// Status configuration shared by the legacy record-detail surfaces.
const CRM_DETAIL_VARIANTS = { Inquiry: 'neutral', Hot: 'danger', Warm: 'warn', Cold: 'info', 'Closed Deal': 'purple', Cancelled: 'neutral' } as const;
export const CRM_DETAIL_STATUSES = CRM_STATUSES.map(value => ({ value, label: value, variant: CRM_DETAIL_VARIANTS[value] }));

export function CrmStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <StatusBadge label="Status unavailable" variant="neutral" dot={false} />;
  const value = normalizeCrmStatus(status);
  return <StatusBadge label={value} variant={CRM_DETAIL_VARIANTS[value]} className={getCRMStatusStyles(value)} dotClassName={getCRMStatusStripColor(value)} />;
}

/** Show all statuses while preserving automatic classification and existing transitions. */
export function CustomerStatusMenu({ status, canEdit, readOnly = false, busy = false, label, onChange, options, restrictions, entityLabel = 'customer' }: {
  status?: string; managed?: boolean; manuallyCancelled?: boolean; canEdit: boolean; readOnly?: boolean; busy?: boolean;
  label?: string; onChange: (status: CrmStatus) => Promise<void>;
  options?: readonly string[]; restrictions?: Record<string, string>;
  entityLabel?: 'customer' | 'Deal';
}) {
  if (!status) return <span className="text-xs text-muted-foreground">{entityLabel === 'Deal' ? 'Deal' : 'Customer'} status unavailable</span>;
  const current = normalizeCrmStatus(status);
  if (!canEdit || readOnly || current === 'Closed Deal') return <span aria-label={label}><CrmStatusBadge status={current} /></span>;
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" disabled={busy} aria-label={label} className={`min-h-9 min-w-0 max-w-full gap-1 rounded-lg text-xs ${getCRMStatusStyles(current)}`}>
      <span className="min-w-0 max-w-[90px] truncate @min-[400px]:max-w-[140px]">{current}</span><ChevronDown size={12} className="shrink-0" />
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent>
    {current === 'Cancelled' && <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">Reopen this {entityLabel} before changing engagement.</p>}
    {CRM_STATUSES.map(option => {
      const allowed = options ? options.includes(option) : current === 'Cancelled' ? option === 'Inquiry' : option !== 'Closed Deal';
      return <DropdownMenuItem key={option} role="menuitemradio" aria-checked={option === current} disabled={!allowed} title={!allowed ? restrictions?.[option] ?? (current === 'Cancelled' ? 'Reopen to Inquiry before changing engagement.' : 'Confirm a related Deal as Closed Deal first.') : undefined} onSelect={() => { if (!busy) void onChange(option); }}>
        <span aria-hidden="true" className={`mr-2 h-2 w-2 rounded-full ${getCRMStatusStripColor(option)}`} />
        {option}{current === 'Cancelled' && option === 'Inquiry' ? ` · Reopen ${entityLabel}` : ''}
        {option === current && <Check aria-hidden="true" size={14} className="ml-auto shrink-0" />}
      </DropdownMenuItem>;
    })}
  </DropdownMenuContent></DropdownMenu>;
}
