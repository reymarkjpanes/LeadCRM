'use client';
import { X } from 'lucide-react';
import { LeadCreatedFilterSchema, type FilterCondition } from '@leadcrm/shared';
export type CreatedFilterDraft = { operator: '' | 'lte' | 'gte' | 'between'; from: string; to: string };
export const emptyCreatedFilter: CreatedFilterDraft = { operator: '', from: '', to: '' };
function parse(value: CreatedFilterDraft) {
  return LeadCreatedFilterSchema.safeParse(value.operator === 'between'
    ? { operator: value.operator, from: value.from, to: value.to }
    : { operator: value.operator, date: value.from });
}
export function createdFilterCondition(value: CreatedFilterDraft): FilterCondition[] {
  const parsed = parse(value);
  if (!parsed.success) return [];
  return [{ field: 'createdAt', operator: parsed.data.operator, value: parsed.data.operator === 'between' ? [parsed.data.from, parsed.data.to] : parsed.data.date }];
}
export function LeadCreatedFilter({ value, onChange }: { value: CreatedFilterDraft; onChange: (value: CreatedFilterDraft) => void }) {
  const parsed = parse(value);
  const format = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(date + 'T00:00:00+08:00'));
  const label = parsed.success ? parsed.data.operator === 'between'
    ? 'Created ' + format(parsed.data.from) + ' – ' + format(parsed.data.to)
    : 'Created ' + (parsed.data.operator === 'lte' ? '≤ ' : '≥ ') + format(parsed.data.date) : '';
  const cls = 'min-h-11 w-full min-w-0 max-w-full rounded-lg border border-border bg-background px-2 text-xs';
  return <section className="mb-3 space-y-2 px-1">
    <label className="block text-xs font-semibold text-muted-foreground">Lead Created<select aria-label="Lead Created condition" className={cls + ' mt-2'} value={value.operator} onChange={e => onChange({ ...value, operator: e.target.value as CreatedFilterDraft['operator'] })}><option value="">Any date</option><option value="lte">≤ Less than or equal</option><option value="gte">≥ Greater than or equal</option><option value="between">Range</option></select></label>
    {value.operator && <label className="block text-xs">{value.operator === 'between' ? 'From' : 'Date'}<input aria-label={value.operator === 'between' ? 'Created From' : 'Created Date'} className={cls + ' mt-1'} type="date" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} /></label>}
    {value.operator === 'between' && <label className="block text-xs">To<input aria-label="Created To" className={cls + ' mt-1'} type="date" value={value.to} min={value.from || undefined} onChange={e => onChange({ ...value, to: e.target.value })} /></label>}
    {value.operator && value.from && (value.operator !== 'between' || value.to) && !parsed.success && <p role="alert" className="text-xs text-red-600">Enter valid dates with From on or before To.</p>}
    {label && <div className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"><span className="min-w-0 flex-1">{label}</span><button type="button" aria-label="Clear Lead Created filter" className="flex min-h-11 min-w-9 items-center justify-center" onClick={() => onChange(emptyCreatedFilter)}><X size={14} /></button></div>}
  </section>;
}
