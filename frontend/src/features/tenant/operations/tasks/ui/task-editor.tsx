"use client";
import { toast } from '@/shared/utils/toast';
import { useId, useRef, useState, type ReactNode } from 'react';
import { taskAssociationIds, type TaskLinkInput, type TaskOption, type TaskRecord } from '@leadcrm/shared';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { USE_MOCK_DATA } from '@/lib/config';
import { usePanelCloseGuard } from '@/shared/hooks/use-panel-close-guard';
import { ManilaDateTimePicker } from '@/shared/components/ui/manila-date-time-picker';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { Button } from '@/shared/components/ui/button';
import { PanelSectionHeading, panelBodyClass, panelCloseClass, panelFooterClass, panelHeaderClass, panelInputClass, panelLabelClass, panelPrimaryButtonClass, panelSecondaryButtonClass, panelSurfaceClass, panelTitleClass } from '@/shared/components/side-panel-styles';
import { isPastManilaTaskDueDateTime, manilaCurrentDate, manilaLocalDateTime, manilaTaskDueInstant, resolveManilaTaskDueDateTime } from '../task-data';
import { TaskSelector } from './task-selector';
import { TaskRecordCreator } from './task-record-creator';
import { TaskDetails } from './task-details';
import { Textarea } from '@/shared/components/ui/textarea';
import { Input } from '@/shared/components/ui/input';
export { TaskSelector, taskInputClass } from './task-selector';
export type TaskLinks = TaskLinkInput;
type TaskEditorProps = { task?: TaskRecord; taskId?: string; links?: TaskLinks; initialMode?: 'view' | 'edit'; readOnly?: boolean; preserveContextLinks?: boolean; onClose: () => void };

export function TaskEditor(props: TaskEditorProps) {
  return props.task || props.taskId ? <TaskDetails {...props} /> : <TaskCreateForm {...props} />;
}

function TaskCreateForm({ links = {}, readOnly = false, preserveContextLinks = false, onClose }: TaskEditorProps) {
  const { user } = useAuth();
  const { addTask } = useData();
  const canCreate = useHasPermission('tasks.create'), assignGrant = useHasPermission('tasks.assign'), canCreateDeals = useHasPermission('deals.create');
  const groupAccess = useHasPermission('tasks.view_all');
  const selfOnly = user?.role !== 'Client Admin' && !groupAccess;
  const canAssign = assignGrant && !selfOnly;
  const initialAssignee = selfOnly ? user?.id ?? '' : '';
  const editable = !readOnly && canCreate;
  const requestId = useRef<string>(crypto.randomUUID());
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskRecord['priority']>('Medium');
  const [dueDate, setDueDate] = useState(manilaLocalDateTime(new Date(Date.now() + 86400000).toISOString()));
  const initialDueDate = useRef(dueDate), dueTrigger = useRef<HTMLButtonElement>(null);
  const [dueDraft, setDueDraft] = useState<string | null>(null);
  const closeDuePicker = () => { setDueDraft(null); dueTrigger.current?.focus({ preventScroll: true }); };
  const [assignedUserId, setOwner] = useState(initialAssignee);
  const [dealIds, setDealIds] = useState(() => taskAssociationIds(links, 'deal'));
  const changeDeals = (ids: string[]) => setDealIds([...new Set([...ids, ...(preserveContextLinks ? taskAssociationIds(links, 'deal') : [])])]);
  const [createdLabels, setCreatedLabels] = useState<TaskOption[]>([]), [creating, setCreating] = useState<'deal' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = !!(title || description || assignedUserId !== initialAssignee || priority !== 'Medium' || dueDate !== initialDueDate.current || JSON.stringify(dealIds) !== JSON.stringify(taskAssociationIds(links, 'deal')));
  const closeGuard = usePanelCloseGuard(onClose, { dirty: editable && dirty, busy });
  const heading = useId();
  const person = assignedUserId === user?.id ? user : undefined;
  const save = async () => {
    if (busy || !editable) return;
    setBusy(true); setError('');
    try {
      if (!title.trim()) throw new Error('Enter a task title.');
      if (!assignedUserId) throw new Error('Select an assigned agent.');
      if (!dealIds.length) throw new Error('Select at least one Deal to associate with this task.');
      const resolvedDueDate = resolveManilaTaskDueDateTime(dueDate);
      if (resolvedDueDate.slice(0, 10) < manilaCurrentDate()) throw new Error('Choose today or a future due date.');
      if (isPastManilaTaskDueDateTime(resolvedDueDate)) throw new Error('Choose a due date and time in the future.');
      if (resolvedDueDate !== dueDate) setDueDate(resolvedDueDate);
      await addTask({ title: title.trim(), description, status: 'pending', priority, dueDate: manilaTaskDueInstant(resolvedDueDate), assignedUserId,
        dealIds: [...new Set([...dealIds, ...(preserveContextLinks ? taskAssociationIds(links, 'deal') : [])])], requestId: requestId.current });
      toast.success('Task created.'); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save task.'); }
    finally { setBusy(false); }
  };
  const renderSection = (sectionTitle: string, number: number, controls: ReactNode, count?: number) => <section className="space-y-4"><PanelSectionHeading number={number}>{sectionTitle}{count !== undefined ? ` (${count})` : ''}</PanelSectionHeading><fieldset disabled={!editable || busy} className="min-w-0 space-y-4">{controls}</fieldset></section>;
  return <Sheet open onOpenChange={open => { if (!open && !busy) { if (creating) setCreating(null); else closeGuard.requestClose(); } }}>
    <SheetContent aria-labelledby={heading} showClose={!busy} className={panelSurfaceClass} closeClassName={panelCloseClass + ' right-3 top-3 sm:right-5'} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) { if (creating) setCreating(null); else closeGuard.requestClose(); } }
    }}>
      <header className={panelHeaderClass + ' pr-16 sm:pr-20'}><h2 id={heading} className={panelTitleClass}>{creating ? 'Create deal' : 'Create task'}</h2>{!creating && <p className="text-sm text-slate-500 mt-1 dark:text-slate-400 font-medium">Complete the task details below.</p>}</header>
      {creating ? <TaskRecordCreator kind={creating} onBusy={setBusy} onCancel={() => setCreating(null)} onCreated={option => { changeDeals([...dealIds, option.id]); setCreatedLabels(previous => [...previous, option]); setCreating(null); }} /> : <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className={panelBodyClass + ' space-y-6'}>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
              {renderSection('Task Information', 1, <>
                  <label className="block space-y-1.5">
                    <span className={panelLabelClass}>Title <span className="text-red-500">*</span></span>
                    <Input
                      className={panelInputClass}
                      required
                      maxLength={255}
                      placeholder="Enter task title..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="min-w-0 space-y-1.5">
                      <span className={panelLabelClass}>Status</span>
                      <Input className={panelInputClass} value="To do" readOnly tabIndex={-1} />
                    </label>
                    <label className="min-w-0 space-y-1.5">
                      <span className={panelLabelClass}>Priority</span>
                      <select
                        className={panelInputClass}
                        value={priority}
                        onChange={(e) =>
                          setPriority(e.target.value as typeof priority)
                        }
                      >
                        {["Low", "Medium", "High"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                  </div>
              </>)}
              {renderSection('Schedule & Assignment', 2, <>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor={`${heading}-due`} className={panelLabelClass}>Due date and time <span className="text-red-500">*</span></label>
                    <button id={`${heading}-due`} ref={dueTrigger} type="button" className={panelInputClass + " text-left"} aria-expanded={dueDraft !== null} aria-controls={`${heading}-due-picker`} onClick={() => { if (dueDraft === null) setDueDraft(dueDate); else closeDuePicker(); }}>{dueDate.replace('T', ' ')}</button>
                    {dueDraft !== null && <ManilaDateTimePicker id={`${heading}-due-picker`} value={dueDraft} prefix="Due" label="Choose due date and time" rollPastToday onCancel={closeDuePicker} onDone={value => { setDueDate(value); closeDuePicker(); }} />}
                  </div>
                  {selfOnly ? <label className="block space-y-1.5"><span className={panelLabelClass}>Assigned Agent</span><Input className={panelInputClass} value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()} readOnly tabIndex={-1} /></label> : <TaskSelector
                    appearance="panel"
                    kind="user"
                    disabled={false}
                    selfAssignmentOnly={!canAssign}
                    label="Assigned Agent"
                    required
                    value={assignedUserId}
                    selectedLabel={
                      person
                        ? person.firstName + " " + person.lastName
                        : undefined
                    }
                    onChange={setOwner}
                  />}
              </>)}
              {renderSection('Additional Information', 3, <>
                  <label className="block space-y-1.5">
                    <span className={panelLabelClass}>Notes</span>
                    <Textarea
                      rows={5}
                      maxLength={10000}
                      placeholder="Describe the task..."
                      className={panelInputClass}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {description.length}/10000
                    </span>
                  </label>
              </>)}
              {renderSection('Associated Deals', 4, <>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Select the Deal associated with this task. Related Leads, Contacts, and Accounts will be linked automatically.
                  </p>
                  <div className="mt-4 space-y-4">
                    <TaskSelector appearance="panel" dropdownPlacement="inline" multiple kind="deal"
                      label="Associate task to deal" required
                      value={dealIds}
                      selectedLabels={createdLabels}
                      onCreate={editable && !USE_MOCK_DATA && canCreateDeals && dealIds.length < 50 ? () => setCreating('deal') : undefined}
                      onChange={changeDeals} />
                  </div>
              </>, dealIds.length)}
        </div>
        <footer className={panelFooterClass + ' justify-between'}><span /><div className="ml-auto flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" className={panelSecondaryButtonClass} disabled={busy} onClick={closeGuard.requestClose}>Cancel</Button>{editable && <Button type="submit" className={panelPrimaryButtonClass} disabled={busy}>{busy ? 'Saving…' : 'Create task'}</Button>}</div></footer>
      </form>}
    </SheetContent>{closeGuard.confirmation}
  </Sheet>;
}
