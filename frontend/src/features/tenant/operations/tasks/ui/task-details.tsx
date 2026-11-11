'use client';
import { toast } from '@/shared/utils/toast';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Archive, Calendar, ChevronDown, ListTodo, MoreHorizontal, Pencil, User, X } from 'lucide-react';
import { TASK_MANUAL_STATUSES, TASK_STATUS_LABELS, taskDisplayStatus, taskAssociationIds, type TaskOption, type TaskRecord, type UpdateTaskDto } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { usePanelCloseGuard } from '@/shared/hooks/use-panel-close-guard';
import { tasksApi } from '@/shared/services/tasks.api';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import { ManilaDateTimePicker } from '@/shared/components/ui/manila-date-time-picker';
import { RecordIdentityHeader, RecordLinkRow, RecordQuickInfo, RecordRows } from '@/shared/components/crm/record-panel-presentation';
import { RecordSection } from '@/shared/components/crm/record-section';
import { InlineEditRows, type InlineEditState, type InlineRowDef } from '@/shared/components/crm/inline-edit-rows';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { panelBodyClass, panelCloseClass, panelHeaderClass, panelInputClass, panelSurfaceClass, panelTitleClass } from '@/shared/components/side-panel-styles';
import { canManageTask, taskRecordHref, taskRecordOptions } from '../task-relations';
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import { isPastManilaTaskDueDateTime, manilaCurrentDate, manilaLocalDateTime, manilaTaskDueInstant, resolveManilaTaskDueDateTime } from '../task-data';
import { useTaskDueTransition } from '../use-task-due-transition';
import { taskStatusClasses } from './task-status';
import { TaskSelector } from './task-selector';
import { TaskRecordCreator } from './task-record-creator';
import type { TaskLinks } from './task-editor';
import { Textarea } from '@/shared/components/ui/textarea';

const idle: InlineEditState = { field: null, dirty: false, busy: false };

/** Adapts Task fields to the shared CRM editor; Task mutations stay in the existing pipeline. */
export function TaskDetails({ task: initialTask, taskId, initialMode = 'view', readOnly = false, links = {}, preserveContextLinks = false, onClose }: {
  task?: TaskRecord; taskId?: string; initialMode?: 'view' | 'edit'; readOnly?: boolean; links?: TaskLinks; preserveContextLinks?: boolean; onClose: () => void;
}) {
  const { user } = useAuth();
  const { updateTask, deleteTask, users } = useData();
  const canRead = useHasPermission('tasks.view'), canEdit = useHasPermission('tasks.edit'), assignGrant = useHasPermission('tasks.assign');
  const groupAccess = useHasPermission('tasks.view_all');
  const canAssign = assignGrant && (user?.role === 'Client Admin' || groupAccess);
  const canComplete = useHasPermission('tasks.complete'), canArchive = useHasPermission('tasks.archive'), canCreateDeals = useHasPermission('deals.create');
  const readableRecords = { deal: useHasPermission('deals.view'), lead: useHasPermission('leads.view'), contact: useHasPermission('contacts.view'), account: useHasPermission('accounts.view') };
  const recordId = initialTask?.id ?? taskId!;
  const detail = useCachedPage<TaskRecord>({ module: 'tasks', params: { recordId }, disabled: USE_MOCK_DATA || !canRead,
    revalidateOnInvalidation: true, fetchFn: async signal => (await tasksApi.get(recordId, signal)).data });
  const [saved, setSaved] = useState(USE_MOCK_DATA ? initialTask : detail.data);
  const [inline, setInline] = useState(idle);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false), [confirmArchive, setConfirmArchive] = useState(false);
  const [generation, setGeneration] = useState(0), [creating, setCreating] = useState(false);
  const [createdDeals, setCreatedDeals] = useState<TaskOption[]>([]);
  const [newDeal, setNewDeal] = useState<TaskOption>();
  const mutationPending = useRef(false), body = useRef<HTMLDivElement>(null);
  const heading = useId();
  const latest = USE_MOCK_DATA ? saved : detail.data;
  const unavailable = !canRead || [401, 403, 404].includes(detail.errorStatus ?? 0) ||
    !!latest && user?.role !== 'Client Admin' && !groupAccess && latest.assignedUserId !== user?.id;
  const ready = !!saved && !unavailable && (USE_MOCK_DATA || !!detail.data);
  useReadRecordNotifications('Task', recordId, !USE_MOCK_DATA && ready && !detail.isInitialLoad && !detail.isRefreshing && !detail.error);
  const owned = ready && canManageTask(latest, user, groupAccess);
  const mutable = owned && !readOnly && !latest?.isArchived;
  const pending = busy || inline.busy;
  const changed = !!saved && !!detail.data && (saved.updatedAt !== detail.data.updatedAt || !saved.updatedAt && JSON.stringify(saved) !== JSON.stringify(detail.data));
  const conflict = saveConflict || !!inline.field && changed;
  const closeGuard = usePanelCloseGuard(onClose, { dirty: mutable && inline.dirty, busy: pending });
  const reportEdit = useCallback((state: InlineEditState) => setInline(previous => previous.field === state.field && previous.dirty === state.dirty && previous.busy === state.busy ? previous : state), []);
  useEffect(() => {
    if (detail.data && !inline.field && !busy && !saveConflict) setSaved(detail.data);
  }, [detail.data, inline.field, busy, saveConflict]);
  useEffect(() => {
    if (!mutable) { setEditing(false); setInline(idle); setCreating(false); setConfirmArchive(false); }
    else if (initialMode === 'edit') setEditing(true);
  }, [mutable, initialMode]);
  useEffect(() => {
    if (editing) body.current?.querySelector<HTMLButtonElement>('button[aria-label^="Edit "]:not(:disabled)')?.focus();
  }, [editing, ready]);

  const mutate = async (updates: UpdateTaskDto) => {
    if (!saved || !mutable || mutationPending.current || conflict || detail.error) throw new Error(conflict ? 'Reload the saved Task before saving.' : 'This task cannot be modified.');
    mutationPending.current = true; setBusy(true); setError('');
    try {
      const canonical = await updateTask(recordId, { ...updates, ...(saved.updatedAt ? { expectedUpdatedAt: saved.updatedAt } : {}) });
      // The pipeline returns the same canonical record used to refresh the Task lists.
      if (!canonical) throw new Error('Unable to refresh the saved Task. Reload before making another change.');
      detail.setData(canonical); setSaved(canonical); toast.success(updates.status === 'completed' ? 'Task completed.' : 'Task updated.');
    } catch (reason) {
      if ((reason as { status?: number })?.status === 409) { setSaveConflict(true); void detail.refetch(); }
      throw reason;
    } finally { mutationPending.current = false; setBusy(false); }
  };
  const saveField = async (field: string, value: string | string[]) => {
    if (!saved || !mutable || !(field === 'assignedUserId' ? canAssign : canEdit)) throw new Error('This field cannot be modified.');
    let next = value;
    if (field === 'title' && !String(value).trim()) throw new Error('Enter a task title.');
    if (field === 'assignedUserId' && !value) throw new Error('Select an assigned agent.');
    if (field === 'dealIds') {
      next = [...new Set([...(Array.isArray(value) ? value : []), ...(preserveContextLinks ? taskAssociationIds(links, 'deal') : [])])];
      if (!next.length && taskAssociationIds(saved, 'deal').length) throw new Error('Select at least one Deal to associate with this task.');
    }
    if (field === 'dueDate') {
      if (value === manilaLocalDateTime(saved.dueDate)) return;
      const resolved = resolveManilaTaskDueDateTime(String(value));
      if (resolved.slice(0, 10) < manilaCurrentDate()) throw new Error('Choose today or a future due date.');
      if (isPastManilaTaskDueDateTime(resolved)) throw new Error('Choose a due date and time in the future.');
      next = manilaTaskDueInstant(resolved);
    }
    const previous = field === 'dealIds' ? taskAssociationIds(saved, 'deal') : saved[field as keyof TaskRecord];
    if (JSON.stringify(next) !== JSON.stringify(previous)) await mutate({ [field]: next });
    setNewDeal(undefined); setCreatedDeals([]);
  };
  const changeStatus = async (status: TaskRecord['status']) => {
    if (!saved || inline.field || !(status === 'completed' ? canComplete : canEdit) || status === saved.status) return;
    try { await mutate({ status }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update task.'); }
  };
  const archive = async () => {
    if (!mutable || !canArchive || pending || inline.field || mutationPending.current) return false;
    mutationPending.current = true; setBusy(true);
    try { await deleteTask(recordId); toast.success('Task archived.'); onClose(); } finally { mutationPending.current = false; setBusy(false); }
  };
  const reload = () => {
    if (!detail.data || pending) return;
    setSaved(detail.data); setInline(idle); setGeneration(value => value + 1); setSaveConflict(false); setError(''); setNewDeal(undefined); setCreatedDeals([]);
  };
  const rows = (definitions: InlineRowDef[]) => <InlineEditRows key={generation} rows={definitions} canEdit={mutable} lockWhileEditing onEscape={closeGuard.requestClose}
    disabled={pending || conflict || !!detail.error || !!inline.field && !definitions.some(row => row.apiField === inline.field)} onEditStateChange={definitions.some(row => row.apiField === inline.field) || !inline.field ? reportEdit : undefined} onSave={saveField} />;
  const agent = saved?.assignedUser?.id === saved?.assignedUserId ? saved?.assignedUser : saved?.assignedUserId === user?.id ? user : users.find(person => person.id === saved?.assignedUserId);
  const agentName = agent ? `${agent.firstName} ${agent.lastName}` : '—';
  useTaskDueTransition(saved && !saved.isArchived && !['completed', 'cancelled'].includes(saved.status) ? saved.dueDate : null);
  const displayStatus = saved ? taskDisplayStatus(saved) : 'pending';
  const statusClass = 'min-h-9 min-w-0 max-w-full gap-1 rounded-lg text-xs ' + taskStatusClasses[displayStatus];
  const statusValue = saved && <span className="min-w-0 max-w-[52px] truncate @min-[400px]:max-w-[140px]">{TASK_STATUS_LABELS[displayStatus]}</span>;
  const requestClose = () => { if (!pending) { if (creating) setCreating(false); else closeGuard.requestClose(); } };
  return <Sheet open onOpenChange={open => { if (!open) requestClose(); }}>
    <SheetContent className={panelSurfaceClass} aria-labelledby={heading} showClose={false} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestClose(); }
    }}>
      {ready && saved && !creating ? <header className={panelHeaderClass + ' @container max-h-[60dvh] overflow-y-auto'}>
        <RecordIdentityHeader topActions panel headingAs="h2" avatar={<ListTodo size={20} />} label="Task" title={saved.title} titleId={heading}
          badges={<Badge variant="outline" className={cn('max-w-full border-border px-1 text-[9px] dark:border-border', saved.priority === 'High' ? 'text-destructive dark:text-destructive' : 'text-muted-foreground dark:text-muted-foreground')}>{saved.priority ?? 'Medium'}</Badge>}
          actions={<>
            {mutable && (canEdit || canAssign || canArchive) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Task actions" title="Task actions" disabled={pending || !!inline.field || conflict || !!detail.error}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
              {(canEdit || canAssign) && <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil size={14} />Edit task</DropdownMenuItem>}
              {canArchive && <DropdownMenuItem destructive onSelect={() => setConfirmArchive(true)}><Archive size={14} />Archive task</DropdownMenuItem>}
            </DropdownMenuContent></DropdownMenu>}
            {mutable && (canEdit || canComplete && saved.status !== 'completed') ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className={statusClass} aria-label={`Task status: ${TASK_STATUS_LABELS[displayStatus]}`} title={TASK_STATUS_LABELS[displayStatus]} disabled={pending || !!inline.field || conflict || !!detail.error}>{statusValue}<ChevronDown size={12} className="shrink-0" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
              {TASK_MANUAL_STATUSES.map(status => <DropdownMenuItem className={taskStatusClasses[status]} key={status} disabled={status === saved.status || !(status === 'completed' ? canComplete : canEdit)} onSelect={() => void changeStatus(status)}>{TASK_STATUS_LABELS[status]}</DropdownMenuItem>)}
            </DropdownMenuContent></DropdownMenu> : <span title={TASK_STATUS_LABELS[displayStatus]} className={statusClass + ' inline-flex items-center border border-border px-3'}>{statusValue}</span>}
            <Button variant="ghost" size="icon" className={panelCloseClass} disabled={pending} onClick={requestClose} aria-label="Close record" title="Close record"><X size={16} /></Button>
          </>} />
        <RecordQuickInfo items={[{ value: agentName === '—' ? '' : agentName, icon: User, label: 'Assigned Agent: ' }, { value: formatDateTime(saved.dueDate), icon: Calendar, label: 'Due: ' }]} />
      </header> : <header className={panelHeaderClass + ' relative pr-16'}><h2 id={heading} className={panelTitleClass}>{creating ? 'Create deal' : 'Task details'}</h2><Button variant="ghost" size="icon" className={panelCloseClass + ' absolute right-3 top-3'} disabled={pending} onClick={requestClose} aria-label="Close record"><X size={16} /></Button></header>}
      {creating && <TaskRecordCreator kind="deal" onBusy={setBusy} onCancel={() => setCreating(false)} onCreated={option => { setNewDeal(option); setCreatedDeals(previous => [...previous, option]); setCreating(false); }} />}
      <div className={creating ? 'hidden' : 'contents'}>
        <div ref={body} className={panelBodyClass + ' space-y-3'}>
          {unavailable ? <p role="alert" className="text-sm text-destructive">{detail.error ?? 'Task access is restricted.'}</p> : <>
            {detail.isInitialLoad && <DataLoadingSpinner label="Loading task" hideLabel />}
            {detail.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{detail.error}</p><Button variant="outline" onClick={() => void detail.refetch()}>Retry loading task</Button></div>}
            {conflict && <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"><p>This Task changed. Your unsaved changes are preserved. Reload the saved Task before saving.</p><Button variant="outline" disabled={!detail.data || detail.isRefreshing || pending} onClick={reload}>Reload saved task</Button></div>}
            {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
            {ready && saved && <>
              <RecordSection title="Task Information" forceOpen={editing}>{rows([
                { label: 'Title', value: saved.title, apiField: canEdit ? 'title' : undefined, alwaysVisible: true, required: true, maxLength: 255, editorFullWidth: true, validate: value => !value.trim() ? 'Enter a task title.' : value.trim().length > 255 ? 'Max 255 characters' : undefined },
                { label: 'Status', value: TASK_STATUS_LABELS[displayStatus], alwaysVisible: true },
                { label: 'Priority', value: saved.priority ?? 'Medium', apiField: canEdit ? 'priority' : undefined, type: 'select', options: ['Low', 'Medium', 'High'], alwaysVisible: true },
              ])}</RecordSection>
              <RecordSection title="Schedule & Assignment" forceOpen={editing}>{rows([
                { label: 'Due date and time', value: manilaLocalDateTime(saved.dueDate), displayValue: formatDateTime(saved.dueDate), apiField: canEdit ? 'dueDate' : undefined, alwaysVisible: true, editorFullWidth: true,
                  renderEditor: props => <TaskDueEditor {...props} /> },
                { label: 'Assigned Agent', value: saved.assignedUserId, displayValue: agentName, apiField: canAssign ? 'assignedUserId' : undefined, alwaysVisible: true, editorFullWidth: true,
                  renderEditor: ({ value, onChange, disabled }) => <TaskSelector appearance="panel" dropdownPlacement="inline" kind="user" label="Assigned Agent" required value={value} selectedLabel={value === saved.assignedUserId ? agentName : undefined} disabled={disabled} onChange={onChange} /> },
              ])}</RecordSection>
              <RecordSection title="Additional Information" forceOpen={editing}>{rows([
                { label: 'Notes', value: saved.description, alwaysVisible: true, apiField: canEdit ? 'description' : undefined, preserveWhitespace: true, editorFullWidth: true,
                  validate: value => value.length > 10000 ? 'Max 10000 characters' : undefined,
                  renderEditor: ({ value, onChange, disabled }) => <label className="min-w-0"><Textarea placeholder="Add task notes..." aria-label="Notes" autoFocus rows={5} maxLength={10000} className={panelInputClass} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /><span className="text-xs text-muted-foreground">{value.length}/10000</span></label> },
              ])}<p className="px-3 pb-2 text-xs text-muted-foreground">{saved.description.length}/10000</p></RecordSection>
              <RecordSection title="Associated Deals" count={taskAssociationIds(saved, 'deal').length} forceOpen={editing}>{rows([
                { label: 'Associated Deals', value: taskAssociationIds(saved, 'deal'), displayValue: taskRecordOptions(saved, 'deal').map(option => option.label), alwaysVisible: true, apiField: canEdit && readableRecords.deal ? 'dealIds' : undefined, editorFullWidth: true,
                  renderEditor: ({ values, onValuesChange, disabled }) => <TaskDealEditor values={values} onChange={onValuesChange} disabled={disabled} saved={saved} newDeal={newDeal} onNewDealApplied={() => setNewDeal(undefined)} createdDeals={createdDeals}
                    onCreate={!USE_MOCK_DATA && canCreateDeals && values.length < 50 ? () => setCreating(true) : undefined} /> },
              ])}
                {readableRecords.deal && !!taskRecordOptions(saved, 'deal').length && <section aria-label="Associated Deal records" className="border-t border-border/60"><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Deal records</h3>{taskRecordOptions(saved, 'deal').map(record => <RecordLinkRow key={record.id} href={taskRecordHref('deal', record.id)} label={record.label} />)}</section>}
                {(['lead', 'contact', 'account'] as const).some(kind => taskRecordOptions(saved, kind).length) && <section aria-label="Historical Task associations" className="border-t border-border/60"><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Historical associations</h3>{(['lead', 'contact', 'account'] as const).filter(kind => readableRecords[kind]).flatMap(kind => taskRecordOptions(saved, kind).map(record => <RecordLinkRow key={kind + record.id} href={taskRecordHref(kind, record.id)} label={record.label} ariaLabel={record.label} subtitle={kind[0].toUpperCase() + kind.slice(1)} />))}</section>}
                {!!saved.relatedRecords?.length && <section aria-label="Related CRM records" className="border-t border-border/60"><h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">Related CRM records</h3><p className="px-3 pt-2 text-xs text-muted-foreground">Connections from the records associated above. These do not change the task’s selected associations.</p><ul className="divide-y divide-border/60">{saved.relatedRecords.filter(record => readableRecords[record.kind]).map(record => <li key={record.kind + record.id}><RecordLinkRow href={taskRecordHref(record.kind, record.id)} label={record.label} ariaLabel={record.label} subtitle={`${record.kind[0].toUpperCase() + record.kind.slice(1)} · Via ${record.via}`} /></li>)}</ul></section>}
              </RecordSection>
              <RecordSection title="Task History"><RecordRows rows={[
                ['Task Owner (Created by):', saved.createdBy ? `${saved.createdBy.firstName} ${saved.createdBy.lastName}` : 'Not recorded'], ['Created', formatDateTime(saved.createdAt)],
                ['Completed', saved.completedAt ? formatDateTime(saved.completedAt) + (saved.completedBy ? ` by ${saved.completedBy.firstName} ${saved.completedBy.lastName}` : '') : undefined],
                ['Assigned by', saved.assignedByUser ? `${saved.assignedByUser.firstName} ${saved.assignedByUser.lastName}` : undefined], ['Archived', saved.isArchived ? 'Archived' : undefined],
              ]} /></RecordSection>
            </>}
          </>}
        </div>
      </div>
      <ConfirmActionDialog open={confirmArchive} onOpenChange={setConfirmArchive} title="Archive task?" description="This task will leave active views and can be restored from Archived Data." variant="destructive" confirmLabel="Archive" isLoading={pending} confirmDisabled={!mutable || !canArchive || !!inline.field || !ready} onConfirm={archive} />
    </SheetContent>{closeGuard.confirmation}
  </Sheet>;
}

function TaskDueEditor({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(true);
  return <div className="min-w-0 max-w-full space-y-2"><Button variant="outline" className="max-w-full whitespace-normal" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}>{value.replace('T', ' ')}</Button>{open && <ManilaDateTimePicker value={value} rollPastToday prefix="Due" label="Choose due date and time" busy={disabled} onCancel={() => setOpen(false)} onDone={next => { onChange(next); setOpen(false); }} />}</div>;
}

function TaskDealEditor({ values, onChange, disabled, saved, newDeal, onNewDealApplied, createdDeals, onCreate }: { values: string[]; onChange: (values: string[]) => void; disabled: boolean; saved: TaskRecord; newDeal?: TaskOption; onNewDealApplied: () => void; createdDeals: TaskOption[]; onCreate?: () => void }) {
  useEffect(() => { if (newDeal) { if (!values.includes(newDeal.id)) onChange([...values, newDeal.id]); onNewDealApplied(); } }, [newDeal, values, onChange, onNewDealApplied]);
  return <div className="min-w-0 space-y-3"><p className="text-xs text-muted-foreground">Select the Deal associated with this task. Related Leads, Contacts, and Accounts will be linked automatically.</p><TaskSelector appearance="panel" dropdownPlacement="inline" multiple kind="deal" label="Associate task to deal" required={!!taskAssociationIds(saved, 'deal').length} value={values} selectedLabels={[...taskRecordOptions(saved, 'deal'), ...createdDeals]} disabled={disabled} onChange={onChange} onCreate={onCreate} /></div>;
}
