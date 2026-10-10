'use client';
import { PageHeader } from '@/shared/components/ui/page-header';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelInputClass, panelPrimaryButtonClass, panelSecondaryButtonClass } from '@/shared/components/side-panel-styles';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { customFieldGroupOptions, CLOSING_FIELD_TYPES, ClosingFieldInputSchema, CUSTOM_FIELD_MODULES, CUSTOM_FIELD_MODULE_LABELS, CUSTOM_FIELD_BUILT_IN_GROUPS, normalizeCustomField, isClosedWonField, type CustomFieldModule, type ClosingField, type ClosingFieldInput } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { Button, CreateButton } from '@/shared/components/ui/button';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { toast } from 'sonner';
import { CustomFieldCard } from './custom-field-card';

const endpoint = '/administration/closing-requirements';
const inputClass = panelInputClass;
type FieldDraft = Omit<ClosingFieldInput, 'appliesTo'>;
const empty = (module: CustomFieldModule): FieldDraft => ({ name: '', type: 'Text', module, group: CUSTOM_FIELD_BUILT_IN_GROUPS[module][0], visibleInForm: true, order: 0, required: false, active: true, options: [], description: '' });

function FieldForm({ field, module, onSaved, onClose }: { field?: ClosingField; module: CustomFieldModule; onSaved: () => void; onClose: () => void }) {
  const canDisable = useHasPermission('custom_fields.disable');
  const [form, setForm] = useState<FieldDraft>(() => field ? { name: field.name, type: field.type, module: field.module, group: field.group, visibleInForm: field.visibleInForm, order: field.order, required: field.required, active: field.active, options: [...field.options], description: field.description } : empty(module));
  const groups = customFieldGroupOptions(form.module, field);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) => setForm(prev => ({ ...prev, [key]: value }));
  const error = (name: string) => errors[name] && <p role="alert" className="text-xs text-destructive">{errors[name]}</p>;
  return <form className="flex h-full min-h-0 min-w-0 flex-col" noValidate onSubmit={async event => {
    event.preventDefault();
    const parsed = ClosingFieldInputSchema.safeParse(form);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message]))); return; }
    if (!groups.includes(form.group)) { setErrors({ group: 'Select a section for this module.' }); return; }
    setBusy(true); setErrors({});
    try { if (field) await apiClient.patch(`${endpoint}/${field.id}`, form); else await apiClient.post(endpoint, form); toast.success(field ? 'Field updated' : 'Field created'); onSaved(); }
    catch (e) { setErrors({ form: e instanceof Error ? e.message : 'Unable to save field.' }); }
    finally { setBusy(false); }
  }}>
    <div className={panelBodyClass + " space-y-5"}>
      <PanelSectionHeading number={1}>Basic Information</PanelSectionHeading>
      <label className="block space-y-1.5 text-xs font-semibold">Field Name <span className="text-red-500">*</span><input autoFocus required maxLength={100} aria-invalid={!!errors.name} className={inputClass} value={form.name} onChange={e => update('name', e.target.value)} />{error('name')}</label>
      <label className="block space-y-1.5 text-xs font-semibold">Field Type <span className="text-red-500">*</span><select required disabled={!!field} className={inputClass} value={form.type} onChange={e => update('type', e.target.value as ClosingFieldInput['type'])}>{CLOSING_FIELD_TYPES.map(type => <option key={type}>{type}</option>)}</select>{field && <span className="block font-normal text-muted-foreground">Add a new field to use a different type.</span>}</label>
      <label className="block space-y-1.5 text-xs font-semibold">Module <span className="text-red-500">*</span><select required disabled={!!field} className={inputClass} value={form.module} onChange={e => { const selected = e.target.value as CustomFieldModule; setForm(prev => ({ ...prev, module: selected, group: CUSTOM_FIELD_BUILT_IN_GROUPS[selected].includes(prev.group) ? prev.group : '' })); }}>{CUSTOM_FIELD_MODULES.map(value => <option key={value} value={value}>{CUSTOM_FIELD_MODULE_LABELS[value]}</option>)}</select>{field && <span className="block font-normal text-muted-foreground">The module stays fixed to preserve record values.</span>}{error('module')}</label>
      <label className="block space-y-1.5 text-xs font-semibold">Group / Section <span className="text-red-500">*</span><select required className={inputClass} value={form.group} disabled={!!field && isClosedWonField(field)} onChange={e => update('group', e.target.value)} aria-invalid={!!errors.group}><option value="">Select a section</option>{groups.filter(group => !field || (group === 'Closed Won Requirements') === isClosedWonField(field)).map(group => <option key={group} value={group}>{group}</option>)}</select>{error('group')}</label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Required<input type="checkbox" role="switch" aria-label="Required" checked={form.required} onChange={e => update('required', e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Visible in Form<input type="checkbox" role="switch" aria-label="Visible in Form" checked={form.visibleInForm} onChange={e => update('visibleInForm', e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
      {isClosedWonField(form) && <p className="text-xs text-muted-foreground">These fields are completed in the Closed Won workflow. Required fields remain enforced there regardless of visibility in ordinary Deal forms.</p>}
      {field && <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Active<input type="checkbox" role="switch" aria-label="Active" disabled={!canDisable} checked={form.active} onChange={e => update('active', e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>}
      <label className="block space-y-1.5 text-xs font-semibold">Description / Help Text<textarea maxLength={1000} className={inputClass} rows={3} value={form.description} onChange={e => update('description', e.target.value)} /></label>
      {form.type === 'Dropdown' && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Dropdown options <span className="text-red-500">*</span></legend>{form.options.map((option, index) => <div key={index} className="flex min-w-0 items-center gap-2"><input aria-label={`Option ${index + 1}`} className={inputClass} maxLength={100} value={option} onChange={e => update('options', form.options.map((value, i) => i === index ? e.target.value : value))} /><Button type="button" variant="ghost" size="icon" aria-label={`Remove option ${index + 1}`} onClick={() => update('options', form.options.filter((_, i) => i !== index))}><X size={16} /></Button></div>)}{error('options')}<Button type="button" variant="outline" disabled={form.options.length >= 100} onClick={() => update('options', [...form.options, ''])}><Plus size={14} />Add option</Button></fieldset>}
      {form.type === 'File Upload' && <p className="text-xs text-muted-foreground">Uses secure record file storage. Maximum 10 MB. PDF, PNG, JPEG, WebP, text, CSV, ZIP, Word and Excel files are supported. A completed upload is required before the field can be saved.</p>}
      {error('form')}
    </div>
    <div className={panelFooterClass + " justify-end"}><Button type="button" variant="outline" className={panelSecondaryButtonClass} onClick={onClose} disabled={busy}>Cancel</Button><Button className={panelPrimaryButtonClass} disabled={busy}>{busy ? 'Saving…' : field ? 'Save Changes' : 'Create Field'}</Button></div>
  </form>;
}

export function ClosingFieldsSettings() {
  const canDisable = useHasPermission('custom_fields.disable');
  const canEdit = useHasPermission('custom_fields.edit'), canCreate = useHasPermission('custom_fields.create');
  const [panel, setPanel] = useState<'new' | ClosingField | null>(null);
  const [module, setModule] = useState<CustomFieldModule | ''>('');
  const [group, setGroup] = useState('');
  const [active, setActive] = useState('');
  const [visible, setVisible] = useState('');
  const [search, setSearch] = useState('');
  const query = useCachedPage<ClosingField[]>({ module: 'settings', params: { closingFields: true }, disabled: false, fetchFn: async signal => (await apiClient.get<{ data: ClosingField[] }>(endpoint, { signal })).data });
  const disable = async (id: string) => { try { await apiClient.patch(`${endpoint}/${id}`, { active: false }); await query.refetch(); toast.success('Field disabled'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to disable field'); } };
  const fields = (query.data ?? []).map(normalizeCustomField);
  const filtered = fields.filter(f => (!module || f.module === module) && (!group || f.group === group) && (!active || String(f.active) === active) && (!visible || String(f.visibleInForm) === visible) && f.name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggleVisibility = async (field: ClosingField) => { try { await apiClient.patch(`${endpoint}/${field.id}`, { visibleInForm: !field.visibleInForm }); await query.refetch(); toast.success(field.visibleInForm ? 'Field hidden from forms' : 'Field shown in forms'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to update visibility'); } };
  return <div className="min-w-0 space-y-5">
    <PageHeader title="Custom Fields" subtitle="Configure custom fields used across LeadCRM modules." actions={canCreate && <CreateButton label="Add New Field" onClick={() => setPanel('new')} />} />
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <input aria-label="Search custom fields" placeholder="Search fields…" className={inputClass} value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter by module" className={inputClass} value={module} onChange={e => { setModule(e.target.value as CustomFieldModule | ''); setGroup(''); }}><option value="">All Modules</option>{CUSTOM_FIELD_MODULES.map(value => <option key={value} value={value}>{CUSTOM_FIELD_MODULE_LABELS[value]}</option>)}</select>
      <select aria-label="Filter by group" className={inputClass} value={group} onChange={e => setGroup(e.target.value)}><option value="">All Groups</option>{[...new Set(fields.filter(f => !module || f.module === module).map(f => f.group))].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by active status" className={inputClass} value={active} onChange={e => setActive(e.target.value)}><option value="">All Statuses</option><option value="true">Enabled</option><option value="false">Disabled</option></select>
      <select aria-label="Filter by visibility" className={inputClass} value={visible} onChange={e => setVisible(e.target.value)}><option value="">All Visibility</option><option value="true">Visible</option><option value="false">Hidden</option></select>
    </div>
    {query.isInitialLoad ? <TableLoadingState label="Loading fields" /> : query.error ? <div role="alert">{query.error}<Button onClick={() => void query.refetch()}>Retry</Button></div> :
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{!filtered.length && <p className="text-sm text-muted-foreground">No custom fields match these filters.</p>}{filtered.map(field => <CustomFieldCard key={field.id} title={field.name} description={field.description || `${field.type} field for ${field.group}.`} context={`${CUSTOM_FIELD_MODULE_LABELS[field.module]} · ${field.group}`} kind="requirements" status={field.active ? 'Enabled' : 'Disabled'} meta={`${field.type} · ${field.required ? 'Required' : 'Optional'} · ${field.visibleInForm ? 'Visible' : 'Hidden'}`} disabled={!canEdit} onClick={() => setPanel(field)} actions={[
        ...(canEdit ? [{ id: 'edit', label: 'Edit Field', onClick: () => setPanel(field) }] : []),
        ...(canEdit ? [{ id: 'visibility', label: field.visibleInForm ? 'Hide in Form' : 'Show in Form', onClick: () => void toggleVisibility(field) }] : []),
        ...(canDisable && field.active ? [{ id: 'disable', label: 'Disable', onClick: () => void disable(field.id) }] : []),
      ]} />)}</div>}
    <SlidingDrawer isOpen={panel !== null} onClose={() => setPanel(null)} title={panel && typeof panel === 'object' ? 'Edit Field' : 'New Field'} subtitle="Complete the custom field details below.">
      {panel && <FieldForm key={typeof panel === 'object' ? panel.id : 'new'} field={typeof panel === 'object' ? panel : undefined} module={module || 'leads'} onClose={() => setPanel(null)} onSaved={() => { void query.refetch(); setPanel(null); }} />}
    </SlidingDrawer>
  </div>;
}
