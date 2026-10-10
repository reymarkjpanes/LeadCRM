'use client';
import { useEffect, useId, useState } from 'react';
import { CUSTOM_FIELD_BUILT_IN_GROUPS, CLOSING_FILE_MAX_BYTES, closingValueError, customFieldNameKey, type ClosingField, type ClosingValues, type CustomFieldModule, type CustomFieldState, type RecordFileMetadata } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { PanelSectionHeading, panelInputClass } from '@/shared/components/side-panel-styles';
import { Button } from '@/shared/components/ui/button';
import { toast } from 'sonner';

export function useRecordCustomFields(module: CustomFieldModule, recordId?: string) {
  const query = useCachedPage<CustomFieldState>({ module, params: { customFields: true, recordId }, revalidateOnInvalidation: true, fetchFn: async signal => {
    if (recordId) return (await apiClient.get<{ data: CustomFieldState }>(`/crm/${module}/${recordId}/custom-fields`, { signal })).data;
    return { fields: (await apiClient.get<{ data: ClosingField[] }>(`/crm/${module}/custom-fields`, { signal })).data, values: {}, files: [] };
  } });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadCount, setUploadCount] = useState(0);
  const [uploads, setUploads] = useState<Record<string, RecordFileMetadata>>({});
  useEffect(() => { setEdits({}); setErrors({}); setUploads({}); }, [module, recordId]);
  const fields = (query.data?.fields ?? []).filter(field => field.module === module && field.active && field.visibleInForm).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const value = (id: string) => edits[id] ?? String(query.data?.values[id] ?? '');
  const allValues = (): ClosingValues => Object.fromEntries(fields.map(field => {
    const raw = value(field.id).trim();
    return [field.id, !raw ? null : field.type === 'Number' ? Number(raw) : raw];
  }));
  const payload = (): ClosingValues => Object.fromEntries(Object.entries(allValues()).filter(([id]) => !recordId || Object.prototype.hasOwnProperty.call(edits, id)));
  const blocked = uploadCount > 0 || !!query.error || (!USE_MOCK_DATA && !query.data);
  const validate = () => {
    const values = allValues();
    const next = Object.fromEntries(fields.flatMap(field => {
      const error = !field.required && recordId && !Object.prototype.hasOwnProperty.call(edits, field.id) ? undefined : closingValueError(field, values[field.id]);
      return error ? [[field.id, error]] : [];
    }));
    setErrors(next);
    if (Object.keys(next).length) document.getElementById(`custom-field-${module}-${fields.find(f => next[f.id])?.id}`)?.focus();
    return !blocked && Object.keys(next).length === 0;
  };
  const update = (id: string, next: string) => { setEdits(prev => ({ ...prev, [id]: next })); setErrors(prev => ({ ...prev, [id]: '' })); };
  const upload = async (field: ClosingField, file: File) => {
    if (!file.size || file.size > CLOSING_FILE_MAX_BYTES) { setErrors(prev => ({ ...prev, [field.id]: 'Choose a nonempty file no larger than 10 MB.' })); return; }
    setUploadCount(count => count + 1);
    try {
      const params = new URLSearchParams({ name: file.name, type: file.type || 'application/octet-stream' });
      const path = recordId ? `/crm/${module}/${recordId}/files` : `/crm/${module}/custom-field-uploads`;
      const result = await apiClient.upload<{ data: RecordFileMetadata }>(`${path}?${params}`, new Blob([file], { type: 'application/octet-stream' }));
      setUploads(prev => ({ ...prev, [result.data.id]: result.data })); update(field.id, result.data.id);
    } catch (error) { setErrors(prev => ({ ...prev, [field.id]: error instanceof Error ? error.message : 'Upload failed.' })); }
    finally { setUploadCount(count => count - 1); }
  };
  return { module, fields, value, update, payload, validate, errors, blocked, uploadCount, upload, query, files: [...(query.data?.files ?? []), ...Object.values(uploads)] };
}
type FieldForm = ReturnType<typeof useRecordCustomFields>;

function CustomFieldInput({ field, form }: { field: ClosingField; form: FieldForm }) {
  const id = `custom-field-${form.module}-${field.id}`, value = form.value(field.id), error = form.errors[field.id];
  const helpId = useId();
  const props = { id, name: `customFieldValues.${field.id}`, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const next = event.target.value;
    if (field.type === 'Number' && !/^-?\d*\.?\d*$/.test(next)) return;
    form.update(field.id, next);
  }, className: panelInputClass + ' min-w-0 max-w-full', required: field.required, 'aria-invalid': !!error, 'aria-describedby': helpId };
  const file = form.files.find(file => file.id === value);
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 [overflow-wrap:anywhere]">{field.name}{field.required && <span className="text-red-500"> *</span>}</label>
    {field.type === 'File Upload' ? <div className="min-w-0 space-y-2"><input id={id} aria-describedby={helpId} aria-invalid={!!error} type="file" className="block w-full min-w-0 max-w-full text-xs" disabled={form.uploadCount > 0} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx" onChange={event => { const selected = event.target.files?.[0]; if (selected) void form.upload(field, selected); }} />{value && <div className="flex min-w-0 items-center gap-2 text-xs"><span className="min-w-0 [overflow-wrap:anywhere]">{file?.name ?? 'Saved file'}</span><button type="button" className="shrink-0 text-primary" onClick={() => form.update(field.id, '')}>Clear</button></div>}<p className="text-xs text-muted-foreground">{form.uploadCount > 0 ? 'Uploading…' : 'Maximum 10 MB.'}</p></div>
      : field.type === 'Long Text' ? <textarea {...props} rows={3} maxLength={10000} />
      : field.type === 'Dropdown' ? <select {...props}><option value="">Select an option</option>{value && !field.options.includes(value) && <option value={value}>{value} (previous choice)</option>}{field.options.map(option => <option key={option}>{option}</option>)}</select>
      : <input {...props} type={field.type === 'Date' ? 'date' : 'text'} inputMode={field.type === 'Number' ? 'decimal' : undefined} maxLength={field.type === 'Number' ? 100 : 1000} />}
    <div id={helpId}>{field.description && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{field.description}</p>}{error && <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">{error}</p>}</div>
  </div>;
}

export function CustomFieldGroup({ form, group }: { form: FieldForm; group: string }) {
  const fields = form.fields.filter(field => customFieldNameKey(field.group) === customFieldNameKey(group));
  return fields.length ? <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{fields.map(field => <CustomFieldInput key={field.id} field={field} form={form} />)}</div> : null;
}

export function CustomFieldExtraGroups({ form, startNumber }: { form: FieldForm; startNumber: number }) {
  const builtIn = CUSTOM_FIELD_BUILT_IN_GROUPS[form.module].map(customFieldNameKey);
  const groups = [...new Set(form.fields.filter(field => !builtIn.includes(customFieldNameKey(field.group))).map(field => field.group))];
  return <>{form.query.error ? <div role="alert" className="text-sm text-destructive">{form.query.error}<Button type="button" variant="ghost" onClick={() => void form.query.refetch()}>Retry custom fields</Button></div> : form.query.isInitialLoad ? <p role="status" className="text-xs text-muted-foreground">Loading custom fields…</p> : null}{groups.map((group, index) => <section key={group} className="min-w-0 space-y-4"><PanelSectionHeading number={startNumber + index}><span className="[overflow-wrap:anywhere]">{group}</span></PanelSectionHeading><CustomFieldGroup form={form} group={group} /></section>)}</>;
}

function RecordCustomFieldEditor({ module, recordId, onClose, onSaved }: { module: CustomFieldModule; recordId: string; onClose: () => void; onSaved: () => void }) {
  const form = useRecordCustomFields(module, recordId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const groups = [...new Set(form.fields.map(field => field.group))];
  return <form aria-label="Edit custom fields" noValidate className="min-w-0 space-y-4 rounded-xl border border-border p-4" onSubmit={async event => {
    event.preventDefault(); if (busy || !form.validate()) return;
    setBusy(true); setError('');
    try { await apiClient.put(`/crm/${module}/${encodeURIComponent(recordId)}`, { customFieldValues: form.payload() }); toast.success('Custom fields updated'); onSaved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save custom fields.'); }
    finally { setBusy(false); }
  }}>
    {groups.map((group, index) => <section key={group} className="min-w-0 space-y-4"><PanelSectionHeading number={index + 1}><span className="[overflow-wrap:anywhere]">{group}</span></PanelSectionHeading><CustomFieldGroup form={form} group={group} /></section>)}
    {form.query.error && <p role="alert" className="text-xs text-destructive">{form.query.error}<Button type="button" variant="ghost" onClick={() => void form.query.refetch()}>Retry custom fields</Button></p>}
    {error && <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || form.blocked}>{busy ? 'Saving…' : 'Save custom fields'}</Button></div>
  </form>;
}

/** Hidden/disabled definitions remain available for reading retained record values. */
export function RecordCustomFieldDetails({ module, recordId, canEdit = false }: { module: CustomFieldModule; recordId: string; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const query = useCachedPage<CustomFieldState>({ module, params: { customFields: true, recordId }, revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: CustomFieldState }>(`/crm/${module}/${recordId}/custom-fields`, { signal })).data });
  const state = query.data;
  if (editing && canEdit) return <RecordCustomFieldEditor module={module} recordId={recordId} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void query.refetch(); }} />;
  if (query.error) return <div role="alert" className="text-xs text-destructive">{query.error}<Button variant="ghost" onClick={() => void query.refetch()}>Retry custom fields</Button></div>;
  if (!state) return null;
  const fields = state.fields.filter(field => state.values[field.id] != null && state.values[field.id] !== '').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return <>{canEdit && state.fields.some(field => field.active && field.visibleInForm) && <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit custom fields</Button></div>}{[...new Set(fields.map(field => field.group))].map(group => <section key={group} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"><h3 className="border-b border-border p-4 text-sm font-semibold [overflow-wrap:anywhere]">{group}</h3><dl className="space-y-3 p-4">{fields.filter(field => field.group === group).map(field => {
    const file = state.files.find(file => file.id === state.values[field.id]);
    return <div key={field.id} className="min-w-0"><dt className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{field.name}{!field.active ? ' · Disabled' : !field.visibleInForm ? ' · Hidden in forms' : ''}</dt><dd className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{field.type === 'File Upload' ? file ? <a className="text-primary underline" href={file.url}>{file.name}</a> : 'File unavailable' : String(state.values[field.id])}</dd></div>;
  })}</dl></section>)}</>;
}
