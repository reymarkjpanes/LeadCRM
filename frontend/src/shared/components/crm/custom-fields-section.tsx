'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus, Trash2, Table2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/shared/components/ui/dialog';
import type { CustomFieldItem } from './moduleConfig';
import { ConfirmActionDialog } from './confirm-action-dialog';

interface CustomFieldsSectionProps {
  fields: CustomFieldItem[];
  canEdit: boolean;
  onAdd: (field: Omit<CustomFieldItem, 'id'>) => void;
  onUpdate: (fieldId: string, value: string) => void;
  onDelete: (fieldId: string) => void | Promise<void>;
}

export function CustomFieldsSection({
  fields,
  canEdit,
  onAdd,
  onUpdate,
  onDelete,
}: CustomFieldsSectionProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleStartEdit = useCallback((field: CustomFieldItem) => {
    if (!canEdit) return;
    setEditingFieldId(field.id);
    setEditValue(String(field.value));
  }, [canEdit]);

  const handleSaveEdit = useCallback((fieldId: string) => {
    onUpdate(fieldId, editValue);
    setEditingFieldId(null);
    setEditValue('');
  }, [editValue, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setEditingFieldId(null);
    setEditValue('');
  }, []);

  const handleConfirmDelete = useCallback(async (fieldId: string) => {
    await onDelete(fieldId);
    setDeleteConfirmId(null);
  }, [onDelete]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, fieldId: string) => {
    if (e.key === 'Enter') handleSaveEdit(fieldId);
    else if (e.key === 'Escape') handleCancelEdit();
  }, [handleSaveEdit, handleCancelEdit]);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-3',
          'text-left text-sm font-semibold text-foreground',
          'hover:bg-accent/50 transition-colors'
        )}
      >
        <span className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <span>Custom Fields</span>
          {fields.length > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground">
              {fields.length}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {canEdit && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setDialogOpen(true); }
              }}
              className="grid h-6 w-6 place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Add custom field"
            >
              <Plus className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-180'
            )}
          />
        </span>
      </button>

      {/* Collapsible content with AnimatePresence */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border">
              {fields.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No custom fields.{' '}
                  {canEdit && (
                    <button type="button" onClick={() => setDialogOpen(true)} className="text-primary hover:underline">
                      Add one
                    </button>
                  )}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {fields.map((field) => (
                    <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2.5 text-xs">
                      <span className="text-muted-foreground truncate" title={field.name}>{field.name}</span>

                      {editingFieldId === field.id ? (
                        <span className="flex items-center gap-1">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, field.id)}
                            className="h-7 text-xs"
                            autoFocus
                          />
                          <button type="button" onClick={() => handleSaveEdit(field.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" aria-label="Save">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={handleCancelEdit} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent" aria-label="Cancel">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(field)}
                          disabled={!canEdit}
                          className={cn('truncate text-left font-medium text-foreground', canEdit && 'cursor-pointer hover:text-primary hover:underline')}
                          title={canEdit ? 'Click to edit' : String(field.value)}
                        >
                          {String(field.value) || '\u2014'}
                        </button>
                      )}

                      {canEdit ? (
                        <button type="button" onClick={() => setDeleteConfirmId(field.id)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-destructive transition-colors" aria-label={`Delete ${field.name}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : <span />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AddFieldDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={onAdd} />
      <ConfirmActionDialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}
        title="Delete custom field?" description={`Delete “${fields.find(field => field.id === deleteConfirmId)?.name ?? ''}” from this record?`}
        variant="destructive" confirmLabel="Delete" confirmDisabled={!canEdit}
        onConfirm={async () => { if (deleteConfirmId) await handleConfirmDelete(deleteConfirmId); }} />
    </div>
  );
}

/* ─── Add Field Dialog ─────────────────────────────────────── */

function AddFieldDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (field: Omit<CustomFieldItem, 'id'>) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldItem['type']>('text');
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), type, value });
    setName('');
    setType('text');
    setValue('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Field</DialogTitle>
          <p className="text-xs text-muted-foreground">Add a custom attribute to this record.</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Field Name <span className="text-red-500">*</span></label>
            <Input required placeholder="e.g. Budget Authority, Referral Code" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Field Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CustomFieldItem['type'])}
                className={cn('flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown Select</option>
                <option value="boolean">Boolean</option>
                <option value="url">URL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Initial Value</label>
              <Input placeholder="Enter value" value={value} onChange={(e) => setValue(e.target.value)} className="h-9" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim()}>Add Field</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
