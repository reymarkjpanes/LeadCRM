'use client';

import { textFieldError } from '@/shared/utils/text-field-validation';
import { useId, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ProductCategoryNameSchema, type ProductCategoryMutation } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { panelInputClass } from '@/shared/components/side-panel-styles';
import { responsiveTypography } from '@/shared/styles/typography';
import { toast } from '@/shared/utils/toast';

export function ManageProductCategories({ open, onOpenChange, categories, pending, ready, canCreate, canEdit, canDelete, mutate }: {
  open: boolean; onOpenChange: (open: boolean) => void; categories: string[]; pending: boolean; ready: boolean;
  canCreate: boolean; canEdit: boolean; canDelete: boolean; mutate: (input: ProductCategoryMutation) => Promise<void>;
}) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const busy = pending || !ready;
  const addError = !editing && (error || (name ? textFieldError(ProductCategoryNameSchema, name) : undefined));
  const renameError = editing && (error || textFieldError(ProductCategoryNameSchema, label));
  async function save(action: 'add' | 'rename') {
    const parsed = ProductCategoryNameSchema.safeParse(action === 'add' ? name : label);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (categories.some(category => category !== (action === 'rename' ? editing : null) && category.toLowerCase() === parsed.data.toLowerCase())) {
      setError('Category names must be unique.'); return;
    }
    try {
      await mutate(action === 'add' ? { action, name: parsed.data } : { action, name: editing!, newName: parsed.data });
      setError('');
      if (action === 'add') setName(''); else setEditing(null);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to save category.';
      setError(message);
    }
  }
  return <>
    <Dialog open={open} onOpenChange={value => { if (!pending && !deleting) { onOpenChange(value); setEditing(null); setName(''); setError(''); } }}>
      <DialogContent aria-label="Manage Product Categories" className="flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-8"><DialogTitle>Manage Product Categories</DialogTitle></DialogHeader>
        {canCreate && <form noValidate className="my-5 shrink-0 space-y-2 border-b border-border pb-5" onSubmit={event => { event.preventDefault(); if (!busy) void save('add'); }}>
          <Label htmlFor={nameId} className={`block ${responsiveTypography.control}`}>Add a new category</Label>
          <div className="flex gap-2">
            <Input id={nameId} aria-invalid={!!addError} aria-describedby={addError ? nameId + '-error' : undefined} placeholder="New category name" required className={panelInputClass + ' min-w-0 flex-1'} value={name} disabled={busy || !!editing} onChange={event => { setName(event.target.value); setError(''); }} />
            <Button className="h-10 shrink-0" disabled={busy || !!editing || !name.trim() || !!addError}><Plus aria-hidden="true" />Add</Button>
          </div>
          {addError && <p id={nameId + '-error'} role="alert" className="text-xs text-destructive">{addError}</p>}
        </form>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {!ready ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading categories…</p> : <div className="space-y-3">
            {!categories.length && <p className="py-5 text-sm text-muted-foreground">No product categories yet.</p>}
            {categories.map(category => <div key={category} className="flex items-start gap-2 rounded-xl border border-border p-3 sm:p-4">
              <div className="min-w-0 flex-1 pt-2">
                {editing === category ? <form noValidate className="space-y-2" onSubmit={event => { event.preventDefault(); if (!busy) void save('rename'); }}>
                  <Input placeholder="Enter category name..." autoFocus aria-invalid={!!renameError} aria-describedby={renameError ? nameId + '-rename-error' : undefined} aria-label={`Category name: ${category}`} required className={panelInputClass} value={label} disabled={busy} onChange={event => { setLabel(event.target.value); setError(''); }} />
                  {renameError && <p id={nameId + '-rename-error'} role="alert" className="text-xs text-destructive">{renameError}</p>}
                  <div className="flex gap-2"><Button size="sm" disabled={busy || !label.trim() || !!renameError}>Save</Button><Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancel</Button></div>
                </form> : <p className={`font-medium [overflow-wrap:anywhere] ${responsiveTypography.control}`}>{category}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                {canEdit && <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Rename ${category}`} disabled={busy || !!editing} onClick={() => { setEditing(category); setLabel(category); setError(''); }}><Pencil aria-hidden="true" /></Button>}
                {canDelete && <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive dark:text-destructive hover:text-destructive dark:hover:text-destructive" aria-label={`Delete ${category} category`} disabled={busy || !!editing} onClick={() => setDeleting(category)}><Trash2 aria-hidden="true" /></Button>}
              </div>
            </div>)}
          </div>}
        </div>
        <div className="mt-5 flex shrink-0 flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{ready ? `${categories.length} ${categories.length === 1 ? 'category' : 'categories'}` : '…'}</span></div>
      </DialogContent>
    </Dialog>
    <ConfirmActionDialog open={!!deleting} onOpenChange={value => { if (!value && !pending) setDeleting(null); }} title="Delete Category?" description={`Are you sure you want to delete "${deleting}"? This action cannot be undone.`} confirmLabel="Delete Category" variant="destructive" isLoading={pending} onConfirm={async () => { await mutate({ action: 'delete', name: deleting! }); }} />
  </>;
}
