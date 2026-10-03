'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { pipelinesApi } from '@/shared/services/pipelines.api';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import type { Stage } from '@/store/types';

function SortableStage({ stage, index, name, busy, canEdit, canDelete, onName, onSave, onRemove }: {
  stage: Stage; index: number; name: string; busy: boolean; canEdit: boolean; canDelete: boolean;
  onName: (name: string) => void; onSave: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: busy || !canEdit });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`relative min-w-0 rounded-xl border border-border bg-card p-3 ${isDragging ? 'z-10 shadow-lg' : ''}`}>
    <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`stage-${stage.id}`}>Stage {index + 1}{stage.isDefault ? ' · Starting stage' : stage.isWon ? ' · Won' : stage.isLost ? ' · Lost' : ''}</label>
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-2">
      {canEdit ? <Button ref={setActivatorNodeRef} {...attributes} {...listeners} variant="ghost" size="icon" disabled={busy}
        aria-label={`Drag to reorder stage: ${stage.name}`} title="Drag to reorder stage"
        className={`touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}><GripVertical size={16} /></Button> : <span />}
      <input id={`stage-${stage.id}`} value={name} onChange={event => onName(event.target.value)} maxLength={100} disabled={busy || !canEdit}
        className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm" />
      {canEdit && <Button size="sm" variant="outline" className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1"
        disabled={busy || !name.trim() || name.trim() === stage.name} onClick={onSave}>Save name</Button>}
      {canDelete && <Button variant="ghost" size="icon" className="col-start-3 row-start-1 text-destructive hover:text-destructive dark:text-destructive dark:hover:text-destructive sm:col-start-4"
        aria-label={`Remove ${stage.name}`} title="Remove stage" disabled={busy || stage.isDefault || stage.isWon || stage.isLost} onClick={onRemove}><Trash2 size={16} /></Button>}
    </div>
  </li>;
}

export function PipelineStagesDialog({ pipelineId, onClose, onChanged }: { pipelineId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const canEdit = useHasPermission('deals.manage_stages'), canCreate = useHasPermission('deals.manage_stages'), canDelete = useHasPermission('deals.manage_stages');
  const [stages, setStages] = useState<Stage[]>([]), [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState(''), [removing, setRemoving] = useState<Stage>();
  const pending = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const previousFocus = useRef<HTMLElement | null>(null);
  const reload = async () => {
    const result = await pipelinesApi.get(pipelineId);
    const ordered = [...result.data.stages].sort((a, b) => a.order - b.order);
    setStages(ordered);
    setNames(previous => Object.fromEntries(ordered.map(stage => {
      const original = stages.find(item => item.id === stage.id);
      return [stage.id, original && previous[stage.id] !== original.name ? previous[stage.id] : stage.name];
    })));
  };
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    let active = true;
    pipelinesApi.get(pipelineId).then(result => {
      if (!active) return;
      const ordered = [...result.data.stages].sort((a, b) => a.order - b.order);
      setStages(ordered); setNames(Object.fromEntries(ordered.map(s => [s.id, s.name])));
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; previousFocus.current?.focus(); };
  }, [pipelineId]);
  const mutate = async (operation: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await operation(); setRemoving(undefined); await reload(); await onChanged(); toast.success('Pipeline stages updated'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update stages'); }
    finally { pending.current = false; setBusy(false); }
  };
  const reorder = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || pending.current || !canEdit) return;
    const from = stages.findIndex(stage => stage.id === active.id), to = stages.findIndex(stage => stage.id === over.id);
    if (from < 0 || to < 0) return;
    const previous = stages;
    const ordered = arrayMove(stages, from, to);
    pending.current = true; setBusy(true); setError(''); setStages(ordered);
    try {
      // Persist IDs only: unsaved name drafts remain keyed to their original stages.
      const result = await pipelinesApi.reorderStages(pipelineId, ordered.map(stage => stage.id));
      setStages([...result.data.stages].sort((a, b) => a.order - b.order));
      await onChanged().catch(() => setError('Order saved, but Deals could not refresh. Refresh Deals to see the changes.'));
      toast.success('Pipeline stages updated');
    } catch (failure) {
      setStages(previous);
      setError(failure instanceof Error ? failure.message : 'Unable to reorder stages');
    } finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent aria-label="Manage pipeline stages" className="flex max-h-[90dvh] flex-col overflow-hidden p-0" tabIndex={-1} ref={node => { if (node && !node.contains(document.activeElement)) node.focus(); }} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:p-6 sm:pr-12"><DialogTitle>Manage pipeline stages</DialogTitle><p className="text-sm text-muted-foreground">Sales Pipeline</p></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
      {error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
      {loading ? <div role="status" aria-label="Loading pipeline stages"><DataLoadingSkeleton rowCount={5} columnCount={2} rowHeight={76} /></div> : removing ? <div className="mt-4 space-y-4">
        <p className="break-words text-sm">Remove “{removing.name}”? This cannot be undone. Stages referenced by Deals, including archived Deals, or stage history cannot be removed.</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { setRemoving(undefined); setError(''); }}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void mutate(() => pipelinesApi.deleteStage(removing.id))}>Remove stage</Button></div>
      </div> : <div className="mt-4 space-y-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => void reorder(event)}>
          <SortableContext items={stages.map(stage => stage.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-3">{stages.map((stage, index) => <SortableStage key={stage.id} stage={stage} index={index}
              name={names[stage.id] ?? ''} busy={busy} canEdit={canEdit} canDelete={canDelete}
              onName={value => setNames(previous => ({ ...previous, [stage.id]: value }))}
              onSave={() => void mutate(() => pipelinesApi.updateStage(stage.id, { name: names[stage.id].trim() }))}
              onRemove={() => { setRemoving(stage); setError(''); }} />)}</ol>
          </SortableContext>
        </DndContext>
        {canCreate && <form className="space-y-2 border-t border-border pt-3" onSubmit={event => {
          event.preventDefault();
          if (name.trim()) void mutate(async () => { await pipelinesApi.createStage({ pipelineId, name: name.trim(), order: Math.max(0, ...stages.map(stage => stage.order)) + 1 }); setName(''); });
        }}>
          <label htmlFor="new-stage-name" className="text-sm">New stage</label>
          <div className="flex min-w-0 items-center gap-2">
            <input id="new-stage-name" maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm" />
            <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="icon" className="shrink-0" disabled={busy || !name.trim()} type="submit" aria-label="Add stage" title="Add stage"><Plus size={18} /></Button></TooltipTrigger><TooltipContent>Add stage</TooltipContent></Tooltip></TooltipProvider>
          </div>
        </form>}
        {!!error && !stages.length && <Button variant="outline" onClick={() => void mutate(reload)}>Retry</Button>}
      </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
