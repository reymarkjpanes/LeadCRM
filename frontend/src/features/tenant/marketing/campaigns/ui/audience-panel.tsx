'use client';
import React, { useEffect, useRef, useState } from 'react';
import { AUDIENCE_FIELDS, AudiencePreviewSchema, CreateAudienceSchema, type AudienceInput, type AudienceBreakdown, type SavedAudience } from '@leadcrm/shared';
import { audiencesApi } from '@/shared/services/audiences.api';
import { SideSheet } from '@/shared/components/side-sheet';

export function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1 text-xs text-red-600">{message}</p> : null;
}
export function AudienceCounts({ counts }: { counts: AudienceBreakdown | null }) {
  return <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700" aria-live="polite">
    {counts ? <><strong>{counts.eligible} eligible recipients</strong><p className="mt-1">Matched: {counts.matched} · Missing email: {counts.missingEmail} · Invalid: {counts.invalidEmail} · Duplicates: {counts.duplicateEmail} · Staff: {counts.staffEmail} · Unsubscribed: {counts.unsubscribed} · Blocked: {counts.blocked} · Inactive: {counts.inactive} · Delivery restricted: {counts.recipientNotAllowed}</p></> : 'Audience estimate unavailable.'}
  </div>;
}
const labels = { status: 'Status', source: 'Lead Source', company: 'Company', productInterest: 'Product Interest', assignedUserId: 'Assigned Agent ID', createdAt: 'Created Date' };
export function AudiencePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (audience: SavedAudience) => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<AudienceInput['source']>('ALL');
  const [conditions, setConditions] = useState<AudienceInput['conditions']>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<AudienceBreakdown | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setCounts(null); setPreviewError('');
    const parsed = AudiencePreviewSchema.safeParse({ source, conditions });
    if (!parsed.success) return;
    const timer = setTimeout(() => { audiencesApi.preview(parsed.data).then(res => { if (!cancelled) setCounts(res.data); }).catch(e => { if (!cancelled) setPreviewError(e.message); }); }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source, conditions]);
  async function save() {
    if (lock.current) return;
    const parsed = CreateAudienceSchema.safeParse({ name, source, conditions });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next); return;
    }
    lock.current = true; setBusy(true); setErrors({});
    try { const res = await audiencesApi.create(parsed.data); onCreated(res.data); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Could not save audience.' }); }
    finally { lock.current = false; setBusy(false); }
  }
  const cls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 dark:bg-slate-900 dark:text-white';
  return <SideSheet isOpen onClose={onClose} title="Create Target Audience" subtitle="Define conditions to segment your leads and contacts">
    <div className="space-y-5 p-5">
      <div><label htmlFor="audience-name">Audience Name <span className="text-red-500">*</span></label><input id="audience-name" className={cls} value={name} onChange={e => setName(e.target.value)} /><FieldError message={errors.name} /></div>
      <div><label htmlFor="audience-source">Source <span className="text-red-500">*</span></label><select id="audience-source" className={cls} value={source} onChange={e => setSource(e.target.value as AudienceInput['source'])}><option value="ALL">All Leads &amp; Contacts</option><option value="LEADS">All Leads</option><option value="CONTACTS">All Contacts</option></select></div>
      <div className="flex justify-between"><span>Conditions (all must match)</span><button type="button" disabled={conditions.length >= 20} onClick={() => setConditions(c => [...c, { field: 'status', operator: 'equals', value: '' }])}>+ Add Condition</button></div>
      <p className="text-xs text-slate-500">Leave conditions empty to include all records from the selected source.</p>
      {conditions.map((c, i) => <div key={i} className="grid grid-cols-3 gap-2 rounded-xl border p-3">
        <div><label htmlFor={`field-${i}`}>Field</label><select id={`field-${i}`} className={cls} value={c.field} onChange={e => setConditions(rows => rows.map((r, j) => j === i ? { field: e.target.value as typeof c.field, operator: e.target.value === 'createdAt' ? 'gte' : 'equals', value: '' } : r))}>{AUDIENCE_FIELDS.map(f => <option key={f} value={f}>{labels[f]}</option>)}</select><FieldError message={errors[`conditions.${i}.field`]} /></div>
        <div><label htmlFor={`operator-${i}`}>Operator</label><select id={`operator-${i}`} className={cls} value={c.operator} onChange={e => setConditions(rows => rows.map((r, j) => j === i ? { ...r, operator: e.target.value as typeof c.operator } : r))}>{(c.field === 'createdAt' ? ['gte', 'lte'] : ['status', 'assignedUserId', 'productInterest'].includes(c.field) ? ['equals', 'not_equals'] : ['equals', 'not_equals', 'contains']).map(op => <option key={op} value={op}>{op.replace('_', ' ')}</option>)}</select><FieldError message={errors[`conditions.${i}.operator`]} /></div>
        <div><label htmlFor={`value-${i}`}>Value</label>{c.field === 'status' ? <select id={`value-${i}`} className={cls} value={c.value} onChange={e => setConditions(rows => rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}><option value="">Select status</option>{['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED', 'Inquiry', 'Qualified', 'Converted', 'Archived'].map(status => <option key={status}>{status}</option>)}</select> : <input id={`value-${i}`} type={c.field === 'createdAt' ? 'date' : 'text'} className={cls} value={c.value} onChange={e => setConditions(rows => rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} />}<FieldError message={errors[`conditions.${i}.value`]} /></div>
        <button type="button" className="text-xs text-red-600" onClick={() => setConditions(rows => rows.filter((_, j) => i !== j))}>Remove condition</button>
      </div>)}
      <AudienceCounts counts={counts} /><FieldError message={previewError || errors.form} />
      <div className="flex justify-end gap-3 border-t pt-4"><button onClick={onClose} disabled={busy}>Cancel</button><button onClick={save} disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Create Audience'}</button></div>
    </div>
  </SideSheet>;
}
