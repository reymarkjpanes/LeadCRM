'use client';
import { panelBodyClass, panelFooterClass, panelInputClass, panelLabelClass, panelPrimaryActionClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AUDIENCE_FIELDS, AUDIENCE_OPERATORS, CRM_STATUSES, LEAD_SOURCES, AudienceConditionSchema, AudiencePreviewSchema, CreateAudienceSchema, type AudienceInput, type AudienceBreakdown, type AudiencePreviewResult, type SavedAudience } from '@leadcrm/shared';
import { audiencesApi } from '@/shared/services/audiences.api';
import { SideSheet } from '@/shared/components/side-sheet';
import { CatalogProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { PaginationControls } from '@/shared/components/crm/pagination-controls';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';

export function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1 text-xs text-red-600">{message}</p> : null;
}
export function AudienceCounts({ counts, channel = 'EMAIL' }: { counts: AudienceBreakdown | null; channel?: 'EMAIL' | 'SMS' }) {
  return <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700" aria-live="polite">
    {counts ? <><strong>{counts.eligible} eligible recipients</strong><p className="mt-1">Matched: {counts.matched} · {channel === 'SMS' ? <>Missing phone: {counts.missingPhone ?? 0} · Invalid phone: {counts.invalidPhone ?? 0} · Duplicates: {counts.duplicatePhone ?? 0} · Do not contact: {counts.doNotContact ?? 0}</> : <>Missing email: {counts.missingEmail} · Invalid: {counts.invalidEmail} · Duplicates: {counts.duplicateEmail} · Staff: {counts.staffEmail} · Unsubscribed: {counts.unsubscribed} · Blocked: {counts.blocked}</>} · Inactive: {counts.inactive} · Delivery restricted: {counts.recipientNotAllowed}</p></> : 'Audience estimate unavailable.'}
  </div>;
}
const labels = { status: 'Status', source: 'Lead Source', company: 'Company', productInterest: 'Product Interest', assignedUserId: 'Assigned Agent', createdAt: 'Created Date' };
type ConditionDraft = { key: number; field: typeof AUDIENCE_FIELDS[number]; operator: typeof AUDIENCE_OPERATORS[number]; value: string | string[] | { from: string; to: string } | null };
const operatorLabels: Record<string, string> = { equals: 'equals', not_equals: 'not equals', contains: 'contains', any: 'Any date', lte: '≤ Less than or equal', gte: '≥ Greater than or equal', between: 'Range' };
export function AudiencePanel({ onClose, onCreated, channel = 'EMAIL' }: { onClose: () => void; onCreated: (audience: SavedAudience) => void; channel?: 'EMAIL' | 'SMS' }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<AudienceInput['source']>('ALL');
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AudiencePreviewResult | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), nextKey = useRef(0);
  const blurTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { blurTimers.current.forEach(clearTimeout); }, []);
  function clearBlur(key: number) {
    clearTimeout(blurTimers.current.get(key));
    blurTimers.current.delete(key);
  }
  const definition = () => ({ source, conditions: conditions.map(({ key: _key, ...c }) => c) });
  function changeCondition(key: number, patch: Partial<ConditionDraft>) {
    if (patch.field || patch.operator) { clearBlur(key); setTouched(previous => new Set([...previous].filter(value => value !== key))); }
    setSubmitted(false);
    setPage(1); setConditions(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  }
  useEffect(() => {
    let cancelled = false;
    setCompanies([]); setCompaniesLoading(true); setCompaniesError('');
    audiencesApi.companies(source).then(result => { if (!cancelled) setCompanies(result.data); }).catch(() => { if (!cancelled) setCompaniesError('Unable to load companies. Reopen the audience to retry.'); }).finally(() => { if (!cancelled) setCompaniesLoading(false); });
    return () => { cancelled = true; };
  }, [source]);
  const conditionError = (condition: ConditionDraft) => {
    if (!submitted && !touched.has(condition.key)) return undefined;
    const { key: _key, ...value } = condition;
    const result = AudienceConditionSchema.safeParse(value);
    if (result.success) return condition.field === 'company' && !companies.includes(String(condition.value)) ? 'Select an existing company for this source.' : undefined;
    // Only curated field messages reach the UI, including unexpected schema errors.
    return ({ status: 'Select a status.', source: 'Select a source.', company: 'Select a company.', productInterest: 'Select a Product Interest.', assignedUserId: 'Select an Assigned Agent.', createdAt: condition.operator === 'between' ? 'Enter valid dates with From on or before To.' : 'Select a valid date.' })[condition.field];
  };
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setPreviewError(''); setLoading(false);
    const parsed = AudiencePreviewSchema.safeParse(definition());
    if (!parsed.success) return;
    setLoading(true);
    const timer = setTimeout(() => { audiencesApi.preview({ ...parsed.data, channel, page, limit }).then(res => { if (!cancelled) setPreview(res.data); }).catch(e => { if (!cancelled) setPreviewError(e.message); }).finally(() => { if (!cancelled) setLoading(false); }); }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source, conditions, channel, page, limit]);
  async function save() {
    if (lock.current) return;
    setSubmitted(true);
    const parsed = CreateAudienceSchema.safeParse({ name, ...definition() });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      if (!name.trim()) next.name = 'Audience name is required.';
      else if (name.length > 150) next.name = 'Use no more than 150 characters.';
      else if (parsed.error.issues.some(issue => issue.path[0] === 'name')) next.name = 'Enter a valid audience name.';
      setErrors(next); return;
    }
    if (conditions.some(c => c.field === 'company' && !companies.includes(String(c.value)))) return;
    lock.current = true; setBusy(true); setErrors({});
    try { const res = await audiencesApi.create(parsed.data); onCreated(res.data); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Could not save audience.' }); }
    finally { lock.current = false; setBusy(false); }
  }
  const cls = panelInputClass + ' min-w-0 max-w-full';
  return <SideSheet isOpen onClose={onClose} width="w-full max-w-[960px]" title="Create Target Audience" subtitle="Define conditions to segment your leads and contacts">
    <div className="flex h-full min-h-0 min-w-0 flex-col"><div className={panelBodyClass + ' @container min-w-0 space-y-5'}>
      <div><label className={panelLabelClass + ' mb-1.5'} htmlFor="audience-name">Audience Name <span className="text-red-500">*</span></label><input id="audience-name" className={cls} value={name} onChange={e => setName(e.target.value)} /><FieldError message={errors.name} /></div>
      <div><label className={panelLabelClass + ' mb-1.5'} htmlFor="audience-source">Source <span className="text-red-500">*</span></label><select id="audience-source" className={cls} value={source} onChange={e => { setPage(1); setSource(e.target.value as AudienceInput['source']); setConditions(rows => rows.map(row => row.field === 'company' ? { ...row, value: '' } : row)); setTouched(new Set()); setSubmitted(false); }}><option value="ALL">All Leads &amp; Contacts</option><option value="LEADS">All Leads</option><option value="CONTACTS">All Contacts</option></select></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold"><span>Conditions (all must match)</span><button type="button" className="min-h-10 rounded-xl px-3 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10" disabled={conditions.length >= 20} onClick={() => { setSubmitted(false); setPage(1); setConditions(c => [...c, { key: nextKey.current++, field: 'status', operator: 'equals', value: '' }]); }}>+ Add Condition</button></div>
      <p className="text-xs text-slate-500">Leave conditions empty to include all records from the selected source.</p>
      {conditions.map((c) => <div key={c.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-2 rounded-xl border border-slate-200 p-3 @min-[800px]:grid-cols-[minmax(160px,1fr)_minmax(230px,1.2fr)_minmax(250px,1.4fr)_2.5rem] dark:border-white/10">
        <div className="min-w-0"><label className={panelLabelClass + ' mb-1.5'} htmlFor={`field-${c.key}`}>Field</label><select id={`field-${c.key}`} className={cls} value={c.field} onChange={e => changeCondition(c.key, { field: e.target.value as ConditionDraft['field'], operator: e.target.value === 'createdAt' ? 'any' : 'equals', value: e.target.value === 'productInterest' ? [] : e.target.value === 'createdAt' ? null : '' })}>{AUDIENCE_FIELDS.map(f => <option key={f} value={f}>{labels[f]}</option>)}</select></div>
        <div className="col-span-2 col-start-1 min-w-0 @min-[800px]:col-span-1 @min-[800px]:col-start-auto"><label className={panelLabelClass + ' mb-1.5'} htmlFor={`operator-${c.key}`}>Operator</label><select id={`operator-${c.key}`} className={cls} value={c.operator} onChange={e => changeCondition(c.key, { operator: e.target.value as ConditionDraft['operator'], ...(c.field === 'createdAt' ? { value: e.target.value === 'any' ? null : e.target.value === 'between' ? { from: '', to: '' } : '' } : {}) })}>{(c.field === 'createdAt' ? ['any', 'lte', 'gte', 'between'] : ['equals', 'not_equals']).map(op => <option key={op} value={op}>{operatorLabels[op]}</option>)}</select></div>
        <div className="col-span-2 col-start-1 min-w-0 @min-[800px]:col-span-1 @min-[800px]:col-start-auto" onFocus={() => clearBlur(c.key)} onBlur={event => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          // React focus events include the existing Product Interest portal.
          // Its next focus event cancels validation while selecting options.
          clearBlur(c.key);
          blurTimers.current.set(c.key, setTimeout(() => {
            blurTimers.current.delete(c.key);
            setTouched(previous => new Set([...previous, c.key]));
          }, 0));
        }}><label className={panelLabelClass + ' mb-1.5'} htmlFor={`value-${c.key}`}>Value <span className="text-red-500">*</span></label>
          {c.field === 'status' || c.field === 'source' ? <select id={`value-${c.key}`} className={cls} value={typeof c.value === 'string' ? c.value : ''} onChange={e => changeCondition(c.key, { value: e.target.value })}><option value="">Select {c.field === 'status' ? 'status' : 'source'}</option>{(c.field === 'status' ? CRM_STATUSES : LEAD_SOURCES).map(value => <option key={value}>{value}</option>)}</select>
            : c.field === 'productInterest' ? <CatalogProductInterestSelect id={`value-${c.key}`} values={Array.isArray(c.value) ? c.value : []} onChange={value => changeCondition(c.key, { value })} />
            : c.field === 'assignedUserId' ? <EntityCombobox entityType="users" placeholder="Select Assigned Agent" value={typeof c.value === 'string' ? c.value : null} onChange={value => changeCondition(c.key, { value: value || '' })} />
            : c.field === 'createdAt' ? c.operator === 'any' ? <p className="flex min-h-11 items-center text-xs text-slate-500">All dates</p> : c.operator === 'between' ? <div className="flex min-w-0 flex-col gap-1">
              <label className="text-xs">From<input id={`value-${c.key}`} aria-label="Created From" type="date" className={cls} value={c.value && typeof c.value === 'object' && !Array.isArray(c.value) ? c.value.from : ''} onChange={e => changeCondition(c.key, { value: { from: e.target.value, to: c.value && typeof c.value === 'object' && !Array.isArray(c.value) ? c.value.to : '' } })} /></label>
              <label className="text-xs">To<input aria-label="Created To" type="date" className={cls} value={c.value && typeof c.value === 'object' && !Array.isArray(c.value) ? c.value.to : ''} min={c.value && typeof c.value === 'object' && !Array.isArray(c.value) ? c.value.from || undefined : undefined} onChange={e => changeCondition(c.key, { value: { from: c.value && typeof c.value === 'object' && !Array.isArray(c.value) ? c.value.from : '', to: e.target.value } })} /></label>
            </div> : <input id={`value-${c.key}`} aria-label="Created Date" type="date" className={cls} value={typeof c.value === 'string' ? c.value : ''} onChange={e => changeCondition(c.key, { value: e.target.value })} />
            : <><select id={`value-${c.key}`} required className={cls} disabled={companiesLoading || !!companiesError} value={typeof c.value === 'string' ? c.value : ''} onChange={e => changeCondition(c.key, { value: e.target.value })}><option value="">{companiesLoading ? 'Loading companies…' : 'Select company'}</option>{companies.map(company => <option key={company} value={company}>{company}</option>)}</select>{companiesError ? <FieldError message={companiesError} /> : !companiesLoading && !companies.length && <p className="mt-1 text-xs text-muted-foreground">No companies available for this source.</p>}</>}
          <FieldError message={conditionError(c)} />
        </div>
        <button type="button" aria-label="Remove condition" title="Remove condition" className="col-start-2 row-start-1 mt-6 flex min-h-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 @min-[800px]:col-start-4 dark:text-red-400 dark:hover:bg-red-500/10" onClick={() => { clearBlur(c.key); setPage(1); setConditions(rows => rows.filter(row => row.key !== c.key)); }}><Trash2 size={16} /></button>
      </div>)}
      <AudienceCounts counts={preview} channel={channel} /><FieldError message={previewError || errors.form} />
      <section aria-label="Eligible Recipients" aria-busy={loading} className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">Eligible Recipients</h3>
        {loading ? <DataLoadingSkeleton rowCount={3} columnCount={2} /> : preview && <>
          <p className="text-xs text-slate-500">Showing {preview.recipients?.length ?? 0} of {preview.eligible} eligible recipients</p>
          {preview.recipients?.length ? <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-white/10 dark:border-white/10">
            {preview.recipients.map(r => <li key={`${r.recordType}-${r.id}`} className="min-w-0 space-y-1 px-3 py-2 text-xs [overflow-wrap:anywhere]"><div className="flex flex-wrap items-center gap-2"><strong>{r.name || 'Unnamed recipient'}</strong><span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300">{r.recordType}</span></div>{r.company && <p className="text-slate-500">{r.company}</p>}<p>{channel === 'SMS' ? r.phone : r.email}</p></li>)}
          </ul> : <p className="rounded-lg border border-slate-200 p-3 text-xs text-slate-500 dark:border-white/10">No eligible recipients match these conditions.</p>}
          {preview.meta && <PaginationControls currentPage={page} totalRecords={preview.meta.total} pageSize={limit} onPageChange={setPage} onPageSizeChange={size => { setPage(1); setLimit(size); }} />}
        </>}
      </section>
      </div><div className={panelFooterClass + ' shrink-0 justify-end'}><button className={panelSecondaryActionClass} onClick={onClose} disabled={busy}>Cancel</button><button onClick={save} disabled={busy} className={panelPrimaryActionClass}>{busy ? 'Saving...' : 'Create Audience'}</button></div>
    </div>
  </SideSheet>;
}
