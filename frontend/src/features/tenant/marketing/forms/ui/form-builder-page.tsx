'use client';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useWorkspacePanel } from '@/shared/lib/overlay-state';
import { panelThemeClass, panelHeaderClass, panelTitleClass, panelCloseClass } from '@/shared/components/side-panel-styles';
import { withProductOptions, withoutRetiredFormSources } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { useEffect, useRef, useState } from 'react';
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import { useRouter } from 'next/navigation';
import { NAVIGATION_INTENT_EVENT, requestNavigation, type NavigationAction, type NavigationIntentEvent } from '@/shared/lib/navigation-intent';
import { ArrowLeft, EyeOff, Plus, RotateCcw } from 'lucide-react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { toast } from '@/shared/utils/toast';
import { FormDefinitionSchema, DEFAULT_DESIGN, DEFAULT_SETTINGS } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { RowActionsMenu } from '@/shared/components/data-grid/row-actions-menu';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import type { FormField, FormRecord } from '../types/form.types';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { getLeadFormFieldCatalog, getShareLink, publishForm, unpublishForm, updateForm } from '../services/forms.service';
import { FormCanvas } from './form-canvas';
import { FieldPalette, isPaletteDrag, type PaletteField } from './field-palette';
import { FormSettingsPanel } from './form-settings-panel';
import { FormSharePanel } from './form-share-panel';
import { Input } from '@/shared/components/ui/input';

function makeField(field: PaletteField): FormField {
  return { id: 'field_' + crypto.randomUUID(), type: field.type, label: field.label, required: field.required ?? false, ...(field.mapToField ? { mapToField: field.mapToField } : {}), ...(field.customFieldId ? { customFieldId: field.customFieldId } : {}), ...(field.options ? { options: [...field.options] } : {}) };
}
export function FormBuilderPage({ form, onBack, onFormUpdate }: { form: FormRecord; onBack: () => void; onFormUpdate: (form: FormRecord) => void }) {
  useReadRecordNotifications('Form', form.id, true);
  const { products, categories } = useProductInterests();
  const { userCan } = useAuth();
  const router = useRouter();
  const canEdit = userCan('forms', 'canEdit');
  const canPublish = userCan('forms', 'canPublish');
  const [local, setLocal] = useState<FormRecord>({ ...form, fields: withoutRetiredFormSources(form.fields), design: { ...DEFAULT_DESIGN, ...form.design }, settings: { ...DEFAULT_SETTINGS, ...form.settings } });
  const [tab, setTab] = useState<'Builder' | 'Settings' | 'Share'>('Builder');
  const [panel, setPanel] = useState<'Fields' | 'Design'>('Fields');
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [tools, setTools] = useState(false);
  const [publication, setPublication] = useState<'publish' | 'unpublish' | null>(null);
  const [exit, setExit] = useState<NavigationAction | null>(null);
  const leaving = useRef(false), exitPending = useRef(false);
  const guardState = useRef({ dirty, saving });
  guardState.current = { dirty, saving };
  const [dragLabel, setDragLabel] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const catalog = useCachedPage({ module: 'settings', params: { leadFormFields: true }, revalidateOnInvalidation: true, fetchFn: getLeadFormFieldCatalog });
  const dockedTools = useMediaQuery('(min-width: 1280px)');
  useWorkspacePanel(256, dockedTools && tab === 'Builder');
  useEffect(() => { if (dockedTools) setTools(false); }, [dockedTools]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => { if (!leaving.current) e.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => {
    const navigation = (event: Event) => {
      if (leaving.current || (!guardState.current.dirty && !guardState.current.saving)) return;
      event.preventDefault();
      if (guardState.current.saving || exitPending.current) return;
      exitPending.current = true;
      setExit(() => (event as NavigationIntentEvent).detail.navigate);
    };
    // Like Workflow Builder, intercept links before Next can render the destination.
    const link = (event: MouseEvent) => {
      if (leaving.current || (!guardState.current.dirty && !guardState.current.saving) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href), current = window.location;
      if (destination.origin !== current.origin || (destination.pathname === current.pathname && destination.search === current.search)) return;
      event.preventDefault(); event.stopPropagation();
      requestNavigation(() => router.push(destination.pathname + destination.search + destination.hash));
    };
    window.addEventListener(NAVIGATION_INTENT_EVENT, navigation);
    window.document.addEventListener('click', link, true);
    return () => {
      window.removeEventListener(NAVIGATION_INTENT_EVENT, navigation);
      window.document.removeEventListener('click', link, true);
    };
  }, [router]);
  function change(patch: Partial<FormRecord>) { if (saving || !canEdit) return; leaving.current = false; setLocal(current => ({ ...current, ...patch })); setDirty(true); setError(''); }
  function add(field: PaletteField, at = local.fields.length) {
    if (local.fields.some(input => field.customFieldId ? input.customFieldId === field.customFieldId : !!field.mapToField && input.mapToField === field.mapToField)) return;
    const fields = [...local.fields]; fields.splice(at, 0, makeField(field)); change({ fields });
  }
  function drag(e: DragEndEvent) {
    setDragLabel('');
    if (!e.over || saving || !canEdit) return;
    const active = String(e.active.id), over = String(e.over.id);
    if (isPaletteDrag(active)) { const field = e.active.data.current?.field as PaletteField | undefined; if (field) { const at = local.fields.findIndex(input => input.id === over); add(field, at < 0 ? local.fields.length : at); } return; }
    const from = local.fields.findIndex(f => f.id === active), to = local.fields.findIndex(f => f.id === over);
    if (from >= 0 && to >= 0) change({ fields: arrayMove(local.fields, from, to) });
  }
  async function save(publish = false, confirmed = false): Promise<boolean> {
    if (saving || (dirty && !canEdit) || (publish && !canPublish) || (!publish && !canEdit)) return false; setError('');
    const parsed = FormDefinitionSchema.safeParse({ name: local.name, fields: withProductOptions(local.fields, products), design: local.design, settings: local.settings });
    setNameInvalid(!local.name.trim());
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(' ')); return false; }
    if (publish && !confirmed) { setPublication('publish'); return false; }
    setSaving(true);
    try {
      let saved = dirty ? await updateForm(local.id, { ...parsed.data, revision: local.revision }) : local;
      setLocal(saved); onFormUpdate(saved); setDirty(false);
      if (publish) { saved = await publishForm(saved.id); setLocal(saved); onFormUpdate(saved); setTab('Share'); }
      toast.success(publish ? 'Form published' : 'Draft saved');
      return true;
    } catch (err) { if (confirmed) throw err; setError(err instanceof Error ? err.message : 'Unable to save form.'); return false; } finally { setSaving(false); }
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
      throw new Error(message);
    } finally { setSaving(false); }
  }
  function discard() { setLocal({ ...form, design: { ...DEFAULT_DESIGN, ...form.design }, settings: { ...DEFAULT_SETTINGS, ...form.settings } }); setDirty(false); setError(''); }
  const panelContent = <>
    <div className="flex border-b border-border bg-card text-card-foreground">{(['Fields', 'Design'] as const).map(t => <button key={t} type="button" onClick={() => setPanel(t)} className={'flex-1 p-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ' + (panel === t ? 'border-b-2 border-primary text-primary' : '')}>{t}</button>)}</div>
    {panel === 'Fields' ? <FieldPalette onAddField={field => add(field)} fields={local.fields} catalog={catalog.data} loading={catalog.isInitialLoad} catalogError={catalog.error ?? undefined} onRetry={() => void catalog.refetch()} dragEnabled={dockedTools} /> : <FieldPalette mode="design" onAddField={field => add(field)} design={local.design} onDesignChange={design => change({ design })} />}
  </>;
  return <DndContext sensors={sensors} onDragStart={event => setDragLabel(event.active.data.current?.field?.label ?? local.fields.find(field => field.id === event.active.id)?.label ?? '')} onDragCancel={() => setDragLabel('')} onDragEnd={drag}>
    <div className="min-w-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border bg-card py-3">
        <button aria-label="Back to Forms" disabled={saving} onClick={() => requestNavigation(onBack)} className="shrink-0 rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft size={16} /></button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{local.name}</h1>
        <span className="text-[9px] uppercase rounded bg-muted text-muted-foreground px-1">{local.status.toLowerCase() === 'published' ? 'Published' : 'Draft'}</span>
        <button disabled={saving || !canPublish} onClick={() => void save(true)} className="bg-primary text-white rounded p-2 text-xs disabled:opacity-50">Publish</button>
        <RowActionsMenu label="More actions" position="right" actions={[
          { id: 'discard', label: 'Discard changes', icon: <RotateCcw size={14} aria-hidden="true" />, disabled: saving || !dirty, onClick: discard },
          ...(local.status.toLowerCase() === 'published' ? [{ id: 'unpublish', label: 'Unpublish', icon: <EyeOff size={14} aria-hidden="true" />, disabled: saving || !canPublish, onClick: () => setPublication('unpublish') }] : []),
        ]} />
      </header>
      <nav className="flex items-center border-b border-border bg-card min-w-0">{(['Builder', 'Settings', 'Share'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={'px-2 sm:px-4 py-3 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ' + (tab === t ? 'text-primary border-b-2 border-primary' : '')}>{t}</button>)}
        <button disabled={saving || !dirty || !canEdit} onClick={() => void save()} className="ml-auto text-xs text-primary px-2 disabled:text-muted-foreground">{saving ? 'Saving…' : 'Save draft'}</button>
      </nav>
      {dirty && <p className="text-xs text-amber-700 dark:text-amber-300 p-2">Unsaved changes</p>}
      {error && <p role="alert" className="m-2 p-3 rounded border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 break-words">{error}</p>}
      <fieldset disabled={tab !== 'Share' && (saving || !canEdit)} className="min-w-0">
        {tab === 'Builder' && <div className="flex min-w-0">
          <div className="flex-1 min-w-0 bg-muted p-3 sm:p-6 space-y-4">
            <label className="block text-xs text-muted-foreground">Form name<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span><Input placeholder="Enter form name..." aria-label="Form name" required aria-invalid={nameInvalid} aria-describedby={nameInvalid ? 'form-name-error' : undefined} className="block mt-1 w-full border rounded p-2 text-sm" maxLength={200} value={local.name} onChange={e => { setNameInvalid(false); change({ name: e.target.value }); }} /></label>
            {nameInvalid && <p id="form-name-error" className="text-xs text-red-600 dark:text-red-400">Form name is required.</p>}
            <FormCanvas fields={withProductOptions(local.fields, products)} productCatalog={{ products, categories }} catalog={catalog.data} design={local.design} onChange={fields => change({ fields })} />
          </div>
          <aside aria-label="Form tools" className={panelThemeClass + " hidden xl:flex w-64 shrink-0 flex-col border-l max-h-[var(--app-viewport-height)] overflow-y-auto overscroll-contain"}>{dockedTools && panelContent}</aside>
        </div>}
        {tab === 'Settings' && <div className="py-4 sm:p-6"><FormSettingsPanel settings={local.settings} onChange={settings => change({ settings })} /></div>}
        {tab === 'Share' && <div className="py-4 sm:p-6 min-w-0"><FormSharePanel form={local} dirty={dirty} shareLink={getShareLink(local.publicId)} /></div>}
      </fieldset>
      {tab === 'Builder' && <div className="xl:hidden sticky bottom-0 bg-card border-t border-border p-2"><button disabled={saving || !canEdit} onClick={() => setTools(true)} className="w-full rounded bg-primary text-white p-3 text-sm flex gap-2 justify-center"><Plus size={16} />Add fields or change design</button></div>}
      <Dialog open={tools} onOpenChange={setTools}><DialogContent aria-label="Form tools" className={panelThemeClass + " !fixed !bottom-0 !left-0 !right-0 !w-full !max-w-none !rounded-b-none !p-0 max-h-[85dvh] flex flex-col"} closeClassName={panelCloseClass}>
        <div className={panelHeaderClass + " pr-20 sm:pr-20"}><h2 className={panelTitleClass}>Form tools</h2><p className="text-xs text-muted-foreground">Tap a field to add it to your form.</p></div>
        <div className="overflow-y-auto min-h-0">{tools && panelContent}</div>
      </DialogContent></Dialog>
      <ConfirmActionDialog open={publication !== null} onOpenChange={open => { if (!open) setPublication(null); }}
        title={publication === 'publish' ? 'Publish form?' : 'Unpublish form?'}
        description={publication === 'publish' ? 'The saved form will be available through its published source links.' : 'The public form will stop accepting submissions. Existing submissions and linked records will be kept.'}
        confirmLabel={publication === 'publish' ? 'Publish form' : 'Unpublish form'} isLoading={saving} confirmDisabled={!canPublish}
        onConfirm={async () => { if (publication === 'publish') { if (!await save(true, true)) return false; } else await unpublish(); setPublication(null); }} />
      <ConfirmActionDialog open={!!exit} onOpenChange={open => { if (!open) { exitPending.current = false; setExit(null); } }}
        title="Discard unsaved changes?" description="Your unsaved form changes will be lost."
        variant="warning" cancelLabel="Keep editing" confirmLabel="Discard changes" isLoading={saving}
        onConfirm={() => { leaving.current = true; discard(); return exit?.(); }} />
    </div>
    <DragOverlay>{dragLabel && <div className={panelThemeClass + " rounded border px-4 py-3 text-sm shadow"}>{dragLabel}</div>}</DragOverlay>
  </DndContext>;
}
