'use client';
import { useNotificationRecordLink } from '@/features/tenant/notifications/hooks/use-notification-record-link';
import { PageHeader } from '@/shared/components/ui/page-header';
import { CreateButton } from '@/shared/components/ui/button';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Layout, Edit, Copy, Trash2, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { RowActionsMenu } from '@/shared/components/data-grid/row-actions-menu';
import { getFormsByTenant, getFormById, createForm, deleteForm, duplicateForm, unpublishForm } from '../services/forms.service';
import type { FormRecord } from '../types/form.types';
import { Badge } from '@/shared/components/ui/badge';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { FormBuilderPage } from './form-builder-page';

export default function FormsPage({ onBuilderActiveChange }: { onBuilderActiveChange?: (active: boolean) => void }) {
  const { tenant, user, userCan } = useAuth();
  const canDelete = userCan('forms', 'canDelete');
  const canEdit = userCan('forms', 'canEdit');
  const canCreate = userCan('forms', 'canCreate'), canPublish = userCan('forms', 'canPublish'), canDuplicate = userCan('forms', 'canDuplicate');
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [active, setActive] = useState<FormRecord | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormRecord | null>(null);
  const mutationLock = useRef(false);
  const identity = `${tenant?.id}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; setActive(null); setDeleteTarget(null); setLoading(true); setError('');
    if (!tenant?.id) return;
    getFormsByTenant(tenant.id).then(data => { if (!cancelled) setForms(data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load forms.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenant?.id, retry]);
  useEffect(() => { onBuilderActiveChange?.(!!active); return () => onBuilderActiveChange?.(false); }, [!!active, onBuilderActiveChange]);
  useNotificationRecordLink('formId', (tenant?.id ?? '') + ':' + (user?.id ?? ''), !!tenant && userCan('forms', 'canView'), getFormById, setActive);
  const mutate = async (work: () => Promise<void>, propagateError = false) => {
    if (mutationLock.current) return; mutationLock.current = true; setBusy(true);
    try { await work(); } catch (err) { if (propagateError) throw err; toast.error(err instanceof Error ? err.message : 'Unable to save form.'); } finally { mutationLock.current = false; setBusy(false); }
  };
  const update = useCallback((form: FormRecord) => { setForms(items => items.map(f => f.id === form.id ? form : f)); setActive(form); }, []);
  const create = () => void mutate(async () => {
    if (!tenant || !canCreate) return;
    const form = await createForm({ name: 'Contact Us', tenantId: tenant.id });
    setForms(items => [form, ...items]); setActive(form);
  });
  const confirmDelete = async () => {
    if (!deleteTarget || !canDelete || deleteTarget.status.toLowerCase() === 'published') return;
    const target = deleteTarget;
    const requestedIdentity = identity;
    await mutate(async () => {
      await deleteForm(target.id);
      if (currentIdentity.current !== requestedIdentity) return;
      setForms(items => items.filter(form => form.id !== target.id));
      setDeleteTarget(null);
      toast.success('Form permanently deleted.');
    }, true);
  };
  if (active) return <FormBuilderPage key={active.id} form={active} onBack={() => setActive(null)} onFormUpdate={update} />;
  return <div className="space-y-5 min-w-0">
    <PageHeader title="Forms" subtitle="Create and manage web forms used to capture inquiries and leads."
      actions={<CreateButton label="New Form" disabled={busy || loading || !canCreate} onClick={create} />} />
    {loading ? <div aria-label="Loading forms" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map(n => <div key={n} className="animate-pulse h-52 rounded-xl bg-slate-200 dark:bg-slate-800" />)}</div>
      : error ? <div role="alert" className="p-6 border rounded-xl"><p>{error}</p><button className="mt-3 text-blue-600 underline" onClick={() => setRetry(v => v + 1)}>Retry</button></div>
      : !forms.length ? <div className="py-16 text-center border border-dashed rounded-xl"><Layout className="mx-auto mb-3 text-slate-400" /><h2 className="font-semibold">No forms yet</h2><p className="text-sm text-slate-500">Create your first Contact Us form to start capturing leads.</p></div>
      : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{forms.map(form => <article key={form.id} className="min-w-0 border border-slate-200 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <button className="h-36 w-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center" aria-label={(canEdit ? 'Edit ' : 'View ') + form.name} onClick={() => setActive(form)}>
          <div aria-hidden="true" className="w-24 bg-white border rounded-md p-3 shadow-sm space-y-2"><div className="h-2 w-2/3 bg-slate-800 rounded" /><div className="h-2 bg-slate-100 rounded" /><div className="h-2 bg-slate-100 rounded" /><div className="h-3 bg-blue-600 rounded" /></div>
        </button>
        <div className="flex justify-between items-center gap-2 p-4">
          <div className="min-w-0"><button className="text-sm font-semibold truncate max-w-full block" onClick={() => setActive(form)}>{form.name}</button><div className="text-xs text-slate-500 mt-1 flex gap-2"><Badge variant={form.status.toLowerCase() === 'published' ? 'default' : 'secondary'} className="uppercase px-1 py-0 text-[10px]">{form.status.toLowerCase() === 'published' ? 'Published' : 'Draft'}</Badge><span>{form.fields.length} fields</span></div></div>
          <RowActionsMenu label="More actions" position="right" actions={[
            { id: 'edit', label: canEdit ? 'Edit' : 'View', icon: <Edit size={14} />, onClick: () => setActive(form) },
            { id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, disabled: busy || !canDuplicate, onClick: () => void mutate(async () => { const copy = await duplicateForm(form.id); setForms(items => [copy, ...items]); }) },
            ...(form.status.toLowerCase() === 'published' ? [{ id: 'unpublish', label: 'Unpublish', icon: <EyeOff size={14} />, disabled: busy || !canPublish,
              onClick: () => void mutate(async () => {
                const requestedIdentity = identity;
                const updated = await unpublishForm(form.id);
                if (currentIdentity.current !== requestedIdentity) return;
                setForms(items => items.map(item => item.id === updated.id ? updated : item));
                toast.success('Form unpublished.');
              }) }] : []),
            { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, destructive: true,
              disabled: busy || !canDelete || form.status.toLowerCase() === 'published',
              disabledReason: form.status.toLowerCase() === 'published' ? 'Unpublish this form before deleting it.' : undefined,
              onClick: () => setDeleteTarget(form) },
          ]} />
        </div>

      </article>)}</div>}
    <ConfirmActionDialog
      open={!!deleteTarget} onOpenChange={open => { if (!open && !busy) setDeleteTarget(null); }}
      title="Delete form?" description="This will permanently delete this form and cannot be undone."
      warning="Its submission history will also be deleted. Linked Leads and Contacts will be kept."
      confirmLabel="Delete Form" cancelLabel="Cancel" variant="destructive" isLoading={busy} onConfirm={confirmDelete}
    />
  </div>;
}
