'use client';
import { RecordSection } from './record-section';
import { useEffect, useState } from 'react';
import { CLOSING_FILE_MAX_BYTES, closingValueError, type ClosingField, type ClosingRequirementsState, type RecordFileMetadata } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { Button } from '@/shared/components/ui/button';
import { TableLoadingState } from './table-loading-state';
import { toast } from 'sonner';
import { CheckCircle2, Circle, LockKeyhole } from 'lucide-react';
import { panelInputClass } from '@/shared/components/side-panel-styles';

function RequirementRow({ field, state, dealId, canEdit, onSaved }: { field: ClosingField; state: ClosingRequirementsState; dealId: string; canEdit: boolean; onSaved: (state: ClosingRequirementsState) => void }) {
  const stored = state.values[field.id];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(stored ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState<RecordFileMetadata>();
  const isEditing = editing && !state.locked;
  const file = state.files.find(f => f.id === stored);
  const inputId = `closing-${dealId}-${field.id}`;
  const complete = stored != null && stored !== '' && !state.errors[field.id] && !closingValueError(field, stored)
    && (field.type !== 'File Upload' || !!file);
  const save = async () => {
    const normalized = value.trim() === '' ? null : field.type === 'Number' ? Number(value) : value.trim();
    const message = closingValueError(field, normalized);
    if (message) { setError(message); return; }
    setBusy(true); setError('');
    try { const result = await apiClient.patch<{ data: ClosingRequirementsState }>(`/crm/deals/${dealId}/closing-requirements`, { values: { [field.id]: normalized } }); setEditing(false); onSaved(result.data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save requirement.'); }
    finally { setBusy(false); }
  };
  const inputClass = `${panelInputClass} ${error ? 'border-destructive' : ''}`;
  return <div className="min-w-0 space-y-2 border-b border-border/60 p-4 last:border-0">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2">{complete ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Complete" /> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Not completed" />}<div className="min-w-0"><label htmlFor={isEditing ? inputId : undefined} className="text-sm font-medium [overflow-wrap:anywhere]">{field.name}{field.required && <span className="text-red-500"> *</span>}</label><p className="mt-0.5 text-xs text-muted-foreground">{field.required ? 'Required' : 'Optional'} · {field.type}</p></div></div>{!isEditing && canEdit && !state.locked && <button type="button" className="min-h-8 shrink-0 rounded-lg px-2 text-xs font-medium text-[#1a73e8] hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Edit ${field.name}`} onClick={() => { setValue(String(stored ?? '')); setError(''); setUploaded(undefined); setEditing(true); }}>Edit</button>}</div>
    {field.description && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{field.description}</p>}
    {isEditing ? <div className="min-w-0 space-y-2">
      {field.type === 'File Upload' ? <><input id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} type="file" disabled={busy} className="w-full min-w-0 text-xs" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx" onChange={async event => {
        const selected = event.target.files?.[0]; if (!selected) return;
        // Selection alone never updates the value; only a committed upload returns an ID.
        if (!selected.size || selected.size > CLOSING_FILE_MAX_BYTES) { setError('Choose a nonempty file no larger than 10 MB.'); return; }
        setBusy(true); setError('');
        try { const query = new URLSearchParams({ name: selected.name, type: selected.type || 'application/octet-stream' }); const result = await apiClient.upload<{ data: RecordFileMetadata }>(`/crm/deals/${dealId}/files?${query}`, new Blob([selected], { type: 'application/octet-stream' })); setUploaded(result.data); setValue(result.data.id); }
        catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
        finally { setBusy(false); }
      }} />{uploaded && <p className="text-xs [overflow-wrap:anywhere]">Uploaded: {uploaded.name}</p>}<p className="text-xs text-muted-foreground">Maximum 10 MB. Save after upload completes.</p></> : field.type === 'Long Text' ? <textarea id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} className={inputClass} rows={3} maxLength={10000} value={value} disabled={busy} onChange={e => setValue(e.target.value)} /> : field.type === 'Dropdown' ? <select id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} className={inputClass} value={value} disabled={busy} onChange={e => setValue(e.target.value)}><option value="">Select an option</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <input id={inputId} className={inputClass} type={field.type === 'Date' ? 'date' : field.type === 'Number' ? 'number' : 'text'} step={field.type === 'Number' ? 'any' : undefined} maxLength={1000} value={value} disabled={busy} required={field.required} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} onChange={e => setValue(e.target.value)} />}
      {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </div> : <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{field.type === 'File Upload' && file ? <a href={file.url} className="text-primary underline">{file.name}</a> : stored == null || stored === '' ? <span className="text-muted-foreground">Not provided</span> : field.type === 'File Upload' ? 'File unavailable' : String(stored)}</p>}
    {!isEditing && state.errors[field.id] && <p className="text-xs text-destructive [overflow-wrap:anywhere]">{state.errors[field.id]}</p>}
  </div>;
}

export function DealClosingRequirements({ dealId, canEdit, onSaved, focusRequested = false }: { focusRequested?: boolean; dealId: string; canEdit: boolean; onSaved: () => void }) {
  const query = useCachedPage<ClosingRequirementsState>({ module: 'deals', params: { recordId: dealId, closingRequirements: true }, revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: ClosingRequirementsState }>(`/crm/deals/${dealId}/closing-requirements`, { signal })).data });
  const [saved, setSaved] = useState<ClosingRequirementsState>();
  useEffect(() => { setSaved(undefined); }, [query.data]);
  const state = saved ?? query.data;
  const fields = state?.fields.filter(field => field.active || state.locked) ?? [];
  const required = fields.filter(field => field.required);
  const completed = state ? required.filter(field => !state.errors[field.id] && !closingValueError(field, state.values[field.id]) && (field.type !== 'File Upload' || state.files.some(file => file.id === state.values[field.id]))).length : 0;
  return <div id={`closing-requirements-${dealId}`} tabIndex={-1} aria-label="Closed Won Requirements" className="min-w-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary">
    <RecordSection title="Closed Won Requirements" forceOpen={focusRequested}>
    <div className="space-y-3 border-b border-border p-4">{state && <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{state.locked ? <><LockKeyhole size={12} />Locked</> : `${completed} of ${required.length} required complete`}</span>}{state && !state.locked && required.length > 0 && <div role="progressbar" aria-label="Required fields completed" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={required.length} className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-blue-600 dark:bg-blue-400" style={{ width: `${completed / required.length * 100}%` }} /></div>}</div>
    {query.isInitialLoad && !state ? <TableLoadingState label="Loading requirements" /> : query.error ? <div role="alert" className="p-3 text-sm">{query.error}<Button onClick={() => void query.refetch()}>Retry</Button></div> : state && <>
      <div className="space-y-2 border-b border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground"><p>{state.locked ? 'Closing evidence is preserved. Historical values cannot be edited.' : !fields.length ? 'No active closing requirements are configured.' : completed < required.length ? 'Complete the required fields below before closing this Deal.' : required.length ? 'All required fields are complete.' : 'There are no required fields. You can add optional closing details below.'}</p>{!state.locked && fields.length > 0 && <p>When this Deal is Qualified, saving a change with all required fields complete automatically closes it as won and locks the closing evidence. Add optional details before saving the final required field.</p>}</div>
      {fields.map(field => <RequirementRow key={`${dealId}:${field.id}:${field.version}`} field={field} state={state} dealId={dealId} canEdit={canEdit} onSaved={next => { setSaved(next); void query.refetch(); onSaved(); toast.success(next.locked ? 'Deal closed as won' : 'Requirement saved'); }} />)}
      {state.locked && !state.fields.length && <dl className="space-y-2 p-3 text-xs">{Object.entries(state.values).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt className="capitalize text-muted-foreground">{key.replaceAll('-', ' ')}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{String(value)}</dd></div>)}</dl>}
    </>}
    </RecordSection>
  </div>;
}
