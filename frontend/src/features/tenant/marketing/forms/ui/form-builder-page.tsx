'use client';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useWorkspacePanel } from '@/shared/lib/overlay-state';
import { panelThemeClass, panelHeaderClass, panelTitleClass, panelCloseClass } from '@/shared/components/side-panel-styles';
import { withProductOptions } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import { FormDefinitionSchema, DEFAULT_DESIGN, DEFAULT_SETTINGS } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { RowActionsMenu } from '@/shared/components/data-grid/row-actions-menu';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import type { FormField, FormFieldType, FormRecord } from '../types/form.types';
import { getEmbedCode, getShareLink, publishForm, unpublishForm, updateForm } from '../services/forms.service';
import { FormCanvas } from './form-canvas';
import { FieldPalette, isPaletteDrag, paletteTypeFromId } from './field-palette';
import { FormSettingsPanel } from './form-settings-panel';
import { FormSharePanel } from './form-share-panel';

function makeField(type: FormFieldType): FormField {
  const mapping = { 'contact-name': 'fullName', 'contact-email': 'email', 'contact-phone': 'phone', 'company-name': 'companyName' } as const;
  const labels: Partial<Record<FormFieldType, string>> = { heading: 'Heading', paragraph: 'Your paragraph text here', divider: '', 'contact-name': 'Contact Name', 'contact-email': 'Email Address', 'contact-phone': 'Contact Number', 'company-name': 'Company Name', 'company-website': 'Company Website', 'single-line': 'Short answer', 'multi-line': 'Long answer', checkbox: 'I agree', dropdown: 'Select an option', radio: 'Choose one' };
  return { id: 'field_' + crypto.randomUUID(), type, label: labels[type] ?? type.charAt(0).toUpperCase() + type.slice(1), required: false, mapToField: mapping[type as keyof typeof mapping], ...(['dropdown', 'radio'].includes(type) ? { options: ['Option 1', 'Option 2'] } : {}) };
}
export function FormBuilderPage({ form, onBack, onFormUpdate }: { form: FormRecord; onBack: () => void; onFormUpdate: (form: FormRecord) => void }) {
  const { products } = useProductInterests();
  const { userCan } = useAuth();
  const canEdit = userCan('forms', 'canEdit');
  const canPublish = userCan('forms', 'canPublish');
  const [local, setLocal] = useState<FormRecord>({ ...form, design: { ...DEFAULT_DESIGN, ...form.design }, settings: { ...DEFAULT_SETTINGS, ...form.settings } });
  const [tab, setTab] = useState<'Builder' | 'Settings' | 'Share'>('Builder');
  const [panel, setPanel] = useState<'Fields' | 'Design'>('Fields');
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [tools, setTools] = useState(false);
  const dockedTools = useMediaQuery('(min-width: 1280px)');
  useWorkspacePanel(256, dockedTools && tab === 'Builder');
  useEffect(() => { if (dockedTools) setTools(false); }, [dockedTools]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function change(patch: Partial<FormRecord>) { if (saving || !canEdit) return; setLocal(current => ({ ...current, ...patch })); setDirty(true); setError(''); }
  function add(type: FormFieldType) { if (type !== 'file') change({ fields: [...local.fields, makeField(type)] }); }
  function drag(e: DragEndEvent) {
    if (!e.over || saving) return;
    const active = String(e.active.id), over = String(e.over.id);
    if (isPaletteDrag(active)) { add(paletteTypeFromId(active)); return; }
    const from = local.fields.findIndex(f => f.id === active), to = local.fields.findIndex(f => f.id === over);
    if (from >= 0 && to >= 0) change({ fields: arrayMove(local.fields, from, to) });
  }
  async function save(publish = false) {
    if (saving || (dirty && !canEdit) || (publish && !canPublish) || (!publish && !canEdit)) return; setError('');
    const parsed = FormDefinitionSchema.safeParse({ name: local.name, fields: withProductOptions(local.fields, products), design: local.design, settings: local.settings });
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(' ')); return; }
    setSaving(true);
    try {
      let saved = dirty ? await updateForm(local.id, { ...parsed.data, revision: local.revision }) : local;
      setLocal(saved); onFormUpdate(saved); setDirty(false);
      if (publish) { saved = await publishForm(saved.id); setLocal(saved); onFormUpdate(saved); setTab('Share'); }
      toast.success(publish ? 'Form published' : 'Draft saved');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save form.'); } finally { setSaving(false); }
  }
  async function unpublish() {
    if (saving || !canPublish) return;
    setSaving(true); setError('');
    try {
      const saved = await unpublishForm(local.id);
      // Preserve unsaved edits while adopting the server publication state and revision.
      setLocal(current => dirty ? { ...saved, name: current.name, fields: current.fields, design: current.design, settings: current.settings } : saved);
      onFormUpdate(saved);
      toast.success('Form unpublished.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to unpublish form.';
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  }
  function discard() { setLocal({ ...form, design: { ...DEFAULT_DESIGN, ...form.design }, settings: { ...DEFAULT_SETTINGS, ...form.settings } }); setDirty(false); setError(''); }
  const panelContent = <>
    <div className="flex border-b">{(['Fields', 'Design'] as const).map(t => <button key={t} type="button" onClick={() => setPanel(t)} className={'flex-1 p-3 text-sm ' + (panel === t ? 'border-b-2 border-primary text-primary' : '')}>{t}</button>)}</div>
    {panel === 'Fields' ? <FieldPalette onAddField={add} /> : <FieldPalette mode="design" onAddField={add} design={local.design} onDesignChange={design => change({ design })} />}
  </>;
  return <DndContext sensors={sensors} onDragEnd={drag}>
    <div className="min-w-0 flex flex-col">
      <header className="flex items-center gap-2 border-b py-3">
        <button aria-label="Back to Forms" disabled={saving} onClick={() => { if (dirty) { setError('Save or discard your edits before leaving.'); return; } onBack(); }} className="shrink-0 p-2"><ArrowLeft size={16} /></button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{local.name}</h1>
        <span className="text-[9px] uppercase rounded bg-muted text-muted-foreground px-1">{local.status.toLowerCase() === 'published' ? 'Published' : 'Draft'}</span>
        <button disabled={saving || !canPublish} onClick={() => void save(true)} className="bg-primary text-white rounded p-2 text-xs disabled:opacity-50">Publish</button>
        <RowActionsMenu label="More actions" position="right" actions={[
          { id: 'discard', label: 'Discard changes', disabled: saving || !dirty, onClick: discard },
          ...(local.status.toLowerCase() === 'published' ? [{ id: 'unpublish', label: 'Unpublish', disabled: saving || !canPublish, onClick: () => void unpublish() }] : []),
        ]} />
      </header>
      <nav className="flex items-center border-b min-w-0">{(['Builder', 'Settings', 'Share'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={'px-2 sm:px-4 py-3 text-xs ' + (tab === t ? 'text-primary border-b-2 border-primary' : '')}>{t}</button>)}
        <button disabled={saving || !dirty || !canEdit} onClick={() => void save()} className="ml-auto text-xs text-primary px-2 disabled:text-slate-400">{saving ? 'Saving…' : 'Save draft'}</button>
      </nav>
      {dirty && <p className="text-xs text-amber-700 p-2">Unsaved changes</p>}
      {error && <p role="alert" className="m-2 p-3 rounded border border-red-200 text-sm text-red-700 break-words">{error}</p>}
      <fieldset disabled={tab !== 'Share' && (saving || !canEdit)} className="min-w-0">
        {tab === 'Builder' && <div className="flex min-w-0">
          <div className="flex-1 min-w-0 bg-muted p-3 sm:p-6 space-y-4">
            <label className="block text-xs text-muted-foreground">Form name<input className="block mt-1 w-full border rounded bg-card text-foreground p-2 text-sm" maxLength={200} value={local.name} onChange={e => change({ name: e.target.value })} /></label>
            <FormCanvas fields={withProductOptions(local.fields, products)} design={local.design} onChange={fields => change({ fields })} />
          </div>
          <aside aria-label="Form tools" className={panelThemeClass + " hidden xl:flex w-64 shrink-0 flex-col border-l max-h-[var(--app-viewport-height)] overflow-y-auto overscroll-contain"}>{panelContent}</aside>
        </div>}
        {tab === 'Settings' && <div className="py-4 sm:p-6"><FormSettingsPanel settings={local.settings} onChange={settings => change({ settings })} /></div>}
        {tab === 'Share' && <div className="py-4 sm:p-6 min-w-0"><FormSharePanel form={local} dirty={dirty} shareLink={getShareLink(local.publicId)} embedCode={getEmbedCode(local.publicId)} /></div>}
      </fieldset>
      {tab === 'Builder' && <div className="xl:hidden sticky bottom-0 bg-card border-t border-border p-2"><button disabled={saving || !canEdit} onClick={() => setTools(true)} className="w-full rounded bg-primary text-white p-3 text-sm flex gap-2 justify-center"><Plus size={16} />Add fields or change design</button></div>}
      <Dialog open={tools} onOpenChange={setTools}><DialogContent aria-label="Form tools" className={panelThemeClass + " !fixed !bottom-0 !left-0 !right-0 !w-full !max-w-none !rounded-b-none !p-0 max-h-[85dvh] flex flex-col"} closeClassName={panelCloseClass}>
        <div className={panelHeaderClass + " pr-20 sm:pr-20"}><h2 className={panelTitleClass}>Form tools</h2><p className="text-xs text-slate-500">Tap a field to add it to your form.</p></div>
        <div className="overflow-y-auto min-h-0">{panelContent}</div>
      </DialogContent></Dialog>
    </div>
  </DndContext>;
}
