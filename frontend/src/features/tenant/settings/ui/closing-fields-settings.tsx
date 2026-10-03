'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CLOSING_FIELD_TYPES, ClosingFieldInputSchema, type ClosingField, type ClosingFieldInput } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Button } from '@/shared/components/ui/button';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { toast } from 'sonner';
import { CustomFieldCard } from './custom-field-card';
import { DealStageAutomationSettings } from './deal-stage-automation-settings';

const endpoint = '/administration/closing-requirements';
const inputClass = 'w-full min-w-0 rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
const empty = (): ClosingFieldInput => ({ name: '', type: 'Text', appliesTo: 'Closed Won Requirements', required: false, active: true, options: [], description: '' });

function FieldForm({ field, onSaved, onClose }: { field?: ClosingField; onSaved: () => void; onClose: () => void }) {
  const canDisable = useHasPermission('custom_fields.disable');
  const [form, setForm] = useState<ClosingFieldInput>(() => field ? { name: field.name, type: field.type, appliesTo: field.appliesTo, required: field.required, active: field.active, options: [...field.options], description: field.description } : empty());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof ClosingFieldInput>(key: K, value: ClosingFieldInput[K]) => setForm(prev => ({ ...prev, [key]: value }));
  const error = (name: string) => errors[name] && <p role="alert" className="text-xs text-destructive">{errors[name]}</p>;
  return <form className="flex h-full min-w-0 flex-col" noValidate onSubmit={async event => {
    event.preventDefault();
    const parsed = ClosingFieldInputSchema.safeParse(form);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message]))); return; }
    setBusy(true); setErrors({});
    try { if (field) await apiClient.patch(`${endpoint}/${field.id}`, parsed.data); else await apiClient.post(endpoint, parsed.data); toast.success(field ? 'Field updated' : 'Field created'); onSaved(); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Unable to save field.' }); }
    finally { setBusy(false); }
  }}>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">1</span><h3 className="text-sm font-bold">Basic Information</h3><div className="h-px flex-1 bg-border" /></div>
      <label className="block space-y-1.5 text-xs font-semibold">Field Name <span className="text-red-500">*</span><input autoFocus required maxLength={100} aria-invalid={!!errors.name} className={inputClass} value={form.name} onChange={e => update('name', e.target.value)} />{error('name')}</label>
      <label className="block space-y-1.5 text-xs font-semibold">Field Type <span className="text-red-500">*</span><select required disabled={!!field} className={inputClass} value={form.type} onChange={e => update('type', e.target.value as ClosingFieldInput['type'])}>{CLOSING_FIELD_TYPES.map(type => <option key={type}>{type}</option>)}</select>{field && <span className="block font-normal text-muted-foreground">Add a new field to use a different type.</span>}</label>
      <label className="block space-y-1.5 text-xs font-semibold">Applies To <span className="text-red-500">*</span><select required className={inputClass} value={form.appliesTo} onChange={() => {}}><option>Closed Won Requirements</option></select></label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Required<input type="checkbox" role="switch" aria-label="Required" checked={form.required} onChange={e => update('required', e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
      {field && <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Active<input type="checkbox" role="switch" aria-label="Active" disabled={!canDisable} checked={form.active} onChange={e => update('active', e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>}
      <label className="block space-y-1.5 text-xs font-semibold">Description / Help Text<textarea maxLength={1000} className={inputClass} rows={3} value={form.description} onChange={e => update('description', e.target.value)} /></label>
      {form.type === 'Dropdown' && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Dropdown options <span className="text-red-500">*</span></legend>{form.options.map((option, index) => <div key={index} className="flex min-w-0 items-center gap-2"><input aria-label={`Option ${index + 1}`} className={inputClass} maxLength={100} value={option} onChange={e => update('options', form.options.map((value, i) => i === index ? e.target.value : value))} /><Button type="button" variant="ghost" size="icon" aria-label={`Remove option ${index + 1}`} onClick={() => update('options', form.options.filter((_, i) => i !== index))}><X size={16} /></Button></div>)}{error('options')}<Button type="button" variant="outline" disabled={form.options.length >= 100} onClick={() => update('options', [...form.options, ''])}><Plus size={14} />Add option</Button></fieldset>}
      {form.type === 'File Upload' && <p className="text-xs text-muted-foreground">Uses Deal file storage. Maximum 10 MB. PDF, PNG, JPEG, WebP, text, CSV, ZIP, Word and Excel files are supported. A completed upload is required before the field can be saved.</p>}
      {error('form')}
    </div>
    <div className="flex shrink-0 justify-end gap-3 border-t border-border bg-card px-4 py-4 sm:px-6"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : field ? 'Save Changes' : 'Create Field'}</Button></div>
  </form>;
}

export function ClosingFieldsSettings() {
  const canDisable = useHasPermission('custom_fields.disable');
  const disable = async (id: string) => { try { await apiClient.patch(`${endpoint}/${id}`, { active: false }); await query.refetch(); toast.success('Field disabled'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to disable field'); } };
  const canEdit = useHasPermission('custom_fields.edit'), canCreate = useHasPermission('custom_fields.create');
  const [panel, setPanel] = useState<'list' | 'new' | ClosingField | null>(null);
  const query = useCachedPage<ClosingField[]>({ module: 'settings', params: { closingFields: true }, fetchFn: async signal => (await apiClient.get<{ data: ClosingField[] }>(endpoint, { signal })).data });
  const fieldCount = query.data?.length ?? 0;
  const fieldStatus = query.isInitialLoad ? 'Loading' : query.error ? 'Unavailable' : query.data?.some(field => field.active) ? 'Enabled' : 'Setup';
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Custom Fields</h2>{canCreate && <Button aria-label="Add New Field" title="Add New Field" onClick={() => setPanel('new')}><Plus size={16} /><span className="hidden sm:inline">Add New Field</span></Button>}</div>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"><CustomFieldCard title="Closed Won Requirements" description="Configure the information and documents needed to close a Deal as won." kind="requirements" status={fieldStatus} meta={query.isInitialLoad ? 'Loading fields…' : query.error ? 'Unable to load fields' : `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`} onClick={() => setPanel('list')} actions={[{ id: 'view', label: 'View requirements', onClick: () => setPanel('list') }, ...(canCreate ? [{ id: 'add', label: 'Add New Field', onClick: () => setPanel('new') }] : [])]} /><DealStageAutomationSettings /></div>
    <SlidingDrawer isOpen={panel !== null} onClose={() => setPanel(null)} title={panel === 'list' ? 'Closed Won Requirements' : typeof panel === 'object' && panel ? 'Edit Field' : 'New Field'} subtitle={panel === 'list' ? 'Manage the fields used to close a Deal as won.' : 'Complete the custom field details below.'}>
      {panel === 'list' ? <div className="space-y-4 p-4 sm:p-6">{query.isInitialLoad ? <TableLoadingState label="Loading requirements" /> : query.error ? <div role="alert">{query.error}<Button onClick={() => void query.refetch()}>Retry</Button></div> : <ul className="divide-y divide-border rounded-xl border border-border">{query.data?.map(field => <li key={field.id} className="flex min-w-0 items-start justify-between gap-3 p-3"><div className="min-w-0 [overflow-wrap:anywhere]"><p className="text-sm font-semibold">{field.name}</p><p className="mt-1 text-xs text-muted-foreground">{field.type} · {field.required ? 'Required' : 'Optional'} · {field.active ? 'Active' : 'Inactive'}</p>{field.type === 'Dropdown' && <p className="mt-1 text-xs text-muted-foreground">{field.options.join(', ')}</p>}{field.description && <p className="mt-1 text-xs">{field.description}</p>}</div><div className="flex shrink-0 flex-wrap gap-1">{canEdit && <Button variant="ghost" size="sm" onClick={() => setPanel(field)}>Edit</Button>}{canDisable && field.active && <Button variant="ghost" size="sm" onClick={() => void disable(field.id)}>Disable</Button>}</div></li>)}</ul>}{canCreate && <Button onClick={() => setPanel('new')}><Plus size={14} />Add New Field</Button>}</div> : panel && <FieldForm key={typeof panel === 'object' ? panel.id : 'new'} field={typeof panel === 'object' ? panel : undefined} onClose={() => setPanel(null)} onSaved={() => { void query.refetch(); setPanel(null); }} />}
    </SlidingDrawer>
  </div>;
}
