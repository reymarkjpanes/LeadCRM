'use client';
import { useEffect, useState } from 'react';
import { CLOSING_FILE_MAX_BYTES, closingValueError, type ClosingField, type ClosingRequirementsState, type RecordFileMetadata } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { Button } from '@/shared/components/ui/button';
import { TableLoadingState } from './table-loading-state';
import { toast } from 'sonner';

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
  const save = async () => {
    const normalized = value.trim() === '' ? null : field.type === 'Number' ? Number(value) : value.trim();
    const message = closingValueError(field, normalized);
    if (message) { setError(message); return; }
    setBusy(true); setError('');
    try { const result = await apiClient.patch<{ data: ClosingRequirementsState }>(`/crm/deals/${dealId}/closing-requirements`, { values: { [field.id]: normalized } }); setEditing(false); onSaved(result.data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save requirement.'); }
    finally { setBusy(false); }
  };
  const inputClass = `w-full min-w-0 rounded-md border bg-background p-2 text-sm ${error ? 'border-destructive' : 'border-input'}`;
  return <div className="min-w-0 space-y-2 border-b border-border/60 p-3 last:border-0">
    <div className="flex min-w-0 items-start justify-between gap-3"><label htmlFor={isEditing ? inputId : undefined} className="text-xs font-medium [overflow-wrap:anywhere]">{field.name}{field.required && <span className="text-red-500"> *</span>}</label>{!isEditing && canEdit && !state.locked && <button type="button" className="shrink-0 text-xs text-primary hover:underline" aria-label={`Edit ${field.name}`} onClick={() => { setValue(String(stored ?? '')); setError(''); setUploaded(undefined); setEditing(true); }}>Edit</button>}</div>
    {field.description && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{field.description}</p>}
    {isEditing ? <div className="min-w-0 space-y-2">
      {field.type === 'File Upload' ? <><input id={inputId} type="file" disabled={busy} className="w-full min-w-0 text-xs" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx" onChange={async event => {
        const selected = event.target.files?.[0]; if (!selected) return;
        // Selection alone never updates the value; only a committed upload returns an ID.
        if (!selected.size || selected.size > CLOSING_FILE_MAX_BYTES) { setError('Choose a nonempty file no larger than 10 MB.'); return; }
        setBusy(true); setError('');
        try { const query = new URLSearchParams({ name: selected.name, type: selected.type || 'application/octet-stream' }); const result = await apiClient.upload<{ data: RecordFileMetadata }>(`/crm/deals/${dealId}/files?${query}`, new Blob([selected], { type: 'application/octet-stream' })); setUploaded(result.data); setValue(result.data.id); }
        catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
        finally { setBusy(false); }
      }} />{uploaded && <p className="text-xs [overflow-wrap:anywhere]">Uploaded: {uploaded.name}</p>}<p className="text-xs text-muted-foreground">Maximum 10 MB. Save after upload completes.</p></> : field.type === 'Long Text' ? <textarea id={inputId} className={inputClass} rows={3} maxLength={10000} value={value} disabled={busy} onChange={e => setValue(e.target.value)} /> : field.type === 'Dropdown' ? <select id={inputId} className={inputClass} value={value} disabled={busy} onChange={e => setValue(e.target.value)}><option value="">Select an option</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <input id={inputId} className={inputClass} type={field.type === 'Date' ? 'date' : field.type === 'Number' ? 'number' : 'text'} step={field.type === 'Number' ? 'any' : undefined} maxLength={1000} value={value} disabled={busy} required={field.required} aria-invalid={!!error} onChange={e => setValue(e.target.value)} />}
      {error && <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </div> : <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{field.type === 'File Upload' && file ? <a href={file.url} className="text-primary underline">{file.name}</a> : stored == null || stored === '' ? '—' : String(stored)}</p>}
    {!isEditing && state.errors[field.id] && <p className="text-xs text-destructive [overflow-wrap:anywhere]">{state.errors[field.id]}</p>}
  </div>;
}

export function DealClosingRequirements({ dealId, canEdit, onSaved }: { dealId: string; canEdit: boolean; onSaved: () => void }) {
  const query = useCachedPage<ClosingRequirementsState>({ module: 'deals', params: { recordId: dealId, closingRequirements: true }, revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: ClosingRequirementsState }>(`/crm/deals/${dealId}/closing-requirements`, { signal })).data });
  const [saved, setSaved] = useState<ClosingRequirementsState>();
  useEffect(() => { setSaved(undefined); }, [query.data]);
  const state = saved ?? query.data;
  return <section id={`closing-requirements-${dealId}`} tabIndex={-1} aria-label="Closed Won Requirements" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary">
    <h3 className="border-b border-border p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closed Won Requirements</h3>
    {query.isInitialLoad && !state ? <TableLoadingState label="Loading requirements" /> : query.error ? <div role="alert" className="p-3 text-sm">{query.error}<Button onClick={() => void query.refetch()}>Retry</Button></div> : state && <>
      <p className="p-3 text-xs text-muted-foreground">{state.locked ? 'Closing evidence is preserved. Historical values cannot be edited.' : state.fields.some(field => field.active && field.required && state.errors[field.id]) ? 'Complete all required Closed Won requirements before closing this Deal.' : 'Required fields are complete. Saving a requirement on a Qualified Deal closes it as won.'}</p>
      {state.fields.filter(field => field.active || state.locked).map(field => <RequirementRow key={`${field.id}:${field.version}`} field={field} state={state} dealId={dealId} canEdit={canEdit} onSaved={next => { setSaved(next); void query.refetch(); onSaved(); toast.success(next.locked ? 'Deal closed as won' : 'Requirement saved'); }} />)}
      {state.locked && !state.fields.length && <dl className="space-y-2 p-3 text-xs">{Object.entries(state.values).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt className="capitalize text-muted-foreground">{key.replaceAll('-', ' ')}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{String(value)}</dd></div>)}</dl>}
    </>}
  </section>;
}
