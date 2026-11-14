'use client';
import { WorkflowVersionHistory } from './workflow-version-history';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAVIGATION_INTENT_EVENT, requestNavigation, type NavigationAction, type NavigationIntentEvent } from '@/shared/lib/navigation-intent';
import { toast } from '@/shared/utils/toast';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  WorkflowDraftSchema, StoredWorkflowDraftSchema, WorkflowDescriptionSchema,
  retiredAccountWorkflowReferences,
  ACCOUNT_RETIREMENT_REASON,
  workflowActionAllowed,
  type Workflow,
  type WorkflowDraft,
  type ActionDefinition,
  type TriggerDefinition,
  type WorkflowOptions,
} from '@leadcrm/shared';
import {
  ArrowLeft,
  PanelLeft,
  Undo2,
  Redo2,
  X,
  Settings2,
  Activity,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { StatusBadge } from '@/shared/components/crm/record-drawer';
import { Input } from '@/shared/components/ui/input';
import { workflowsApi } from '@/shared/services/workflows.api';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { WorkflowDialog } from './workflow-dialog';
import {
  ActionFields,
  ConditionFields,
  emptyOptions,
  workflowControl,
  WorkflowTemplateFields,
} from './workflow-fields';
import { bindWorkflowTemplate, workflowTemplateDescriptor, workflowTemplateSetupIssues } from '../services/workflow-template-bindings';
import { WorkflowLibrary } from './workflow-library';
import { WorkflowCanvas } from './workflow-canvas';
import { WorkflowRuns } from './workflow-execution-log-modal';
import { WorkflowTestPanel } from './workflow-test-panel';
import {
  canPlace,
  editorDocument,
  editorIssues,
  newWorkflowCondition,
  insertAction,
  moveAction,
  toDraft,
  workflowNameIssue,
  retiredActionLabels,
  type DragItem,
  type EditorDocument,
  type LibraryItem,
  type Placement,
  type StepSelection,
} from '../services/workflow-editor';
import { Textarea } from '@/shared/components/ui/textarea';

interface Props {
  initial: WorkflowDraft;
  workflowId?: string;
  templateIndex?: number;
  templateIdentity?: number | string;
  initialStatus?: Workflow['status'];
  initialVersion?: number;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  options?: WorkflowOptions;
  existingWorkflows?: Array<{ id: string; name: string }>;
  onCheckName?: (name: string, excludeId?: string) => Promise<boolean>;
  canActivate: boolean;
  canPause?: boolean;
  canExecute?: boolean;
  canViewRuns?: boolean;
  readOnly?: boolean;
  onSave: (draft: WorkflowDraft) => Promise<Workflow | void>;
  onPause?: () => Promise<Workflow>;
  onRestoreVersion?: (version: number) => Promise<void>;
  onClose: () => void;
}
interface History {
  present: EditorDocument;
  past: EditorDocument[];
  future: EditorDocument[];
}
export default function WorkflowBuilder({
  initial,
  workflowId,
  templateIndex,
  templateIdentity,
  initialStatus,
  initialVersion,
  triggers,
  actions: definitions,
  options = emptyOptions,
  existingWorkflows = [],
  onCheckName,
  canActivate,
  canPause = false,
  canExecute = false,
  canViewRuns = false,
  readOnly,
  onSave,
  onPause,
  onRestoreVersion,
  onClose,
}: Props) {
  const router = useRouter();
  const [history, setHistory] = useState<History>(() => ({
    present: editorDocument(initial),
    past: [],
    future: [],
  }));
  const [saved, setSaved] = useState(() => toDraft(initial)),
    [savedId, setSavedId] = useState(workflowId);
  const [savedStatus, setSavedStatus] = useState(
    initialStatus ?? (initial.isActive ? 'ACTIVE' : 'DRAFT'),
  );
  const [savedVersion, setSavedVersion] = useState(initialVersion);
  const [nameCheck, setNameCheck] = useState<{ name: string; available?: boolean; failed?: boolean } | null>(null);
  const [selected, setSelected] = useState<StepSelection | null>(
    initial.name ? null : 'details',
  );
  const [pending, setPending] = useState<LibraryItem | null>(null),
    [dragging, setDragging] = useState<DragItem | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null),
    [showLibrary, setShowLibrary] = useState(false);
  const [view, setView] = useState<'builder' | 'activity'>('builder'),
    [showTest, setShowTest] = useState(false);
  const [wide, setWide] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [changeTrigger, setChangeTrigger] = useState<string | null>(null),
    [exit, setExit] = useState<NavigationAction | null>(null);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [templateDetached, setTemplateDetached] = useState(false);
  const operation = useRef(false),
    focusOrigin = useRef<HTMLElement | null>(null),
    leaving = useRef(false),
    exitPending = useRef(false);
  const inspectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wide && selected)
      inspectorRef.current
        ?.querySelector<HTMLElement>('input,select,textarea')
        ?.focus();
  }, [selected, wide]);
  const { present: document } = history,
    { draft } = document;
  const trigger = triggers.find((entry) => entry.type === draft.trigger);
  const template = !templateDetached ? workflowTemplateDescriptor(templateIdentity ?? templateIndex) : undefined;
  const linkedTemplate = template?.trigger === draft.trigger && template.setup !== 'none' ? template : undefined;
  const dirty = JSON.stringify(toDraft(draft)) !== JSON.stringify(saved);
  const guardState = useRef({ dirty, readOnly });
  guardState.current = { dirty, readOnly };
  useEffect(() => { leaving.current = false; }, [draft]);
  const locked = !!readOnly || busy;
  const descriptionResult = WorkflowDescriptionSchema.safeParse(draft.description);
  const descriptionIssue = (!savedId || draft.description !== saved.description) && !descriptionResult.success
    ? descriptionResult.error.issues[0]?.message : undefined;
  const nameIssue = workflowNameIssue(draft.name, existingWorkflows, savedId) ||
    (nameCheck?.name === draft.name && nameCheck.available === false ? 'A workflow with this name already exists. Choose another name.' : '');
  const issues = [
    ...editorIssues(document, triggers, definitions, options, false, savedId && savedStatus !== 'DRAFT' ? saved.conditions : undefined, savedId ? saved.actions : undefined),
    ...workflowTemplateSetupIssues(draft, linkedTemplate?.id, options).map(message => ({ step: 'conditions' as const, message })),
    ...(nameIssue && draft.name.trim() ? [{ step: 'details' as const, message: nameIssue }] : []),
  ];
  const actionIndex = selected?.startsWith('action:')
    ? document.actionIds.indexOf(selected.slice(7))
    : -1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (!onCheckName || !WorkflowDraftSchema.shape.name.safeParse(draft.name).success || readOnly) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      onCheckName(draft.name, savedId).then((available) => {
        if (!cancelled) setNameCheck({ name: draft.name, available });
      }).catch(() => {
        if (!cancelled) setNameCheck({ name: draft.name, failed: true });
      });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft.name, savedId, onCheckName, readOnly]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => { setMobile(media.matches); setDragging(null); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!dirty || readOnly) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, readOnly]);
  useEffect(() => {
    const intent = (event: Event) => {
      if (leaving.current || !guardState.current.dirty || guardState.current.readOnly) return;
      event.preventDefault();
      if (exitPending.current) return;
      exitPending.current = true;
      setExit(() => (event as NavigationIntentEvent).detail.navigate);
    };
    const link = (event: MouseEvent) => {
      if (leaving.current || !guardState.current.dirty || guardState.current.readOnly || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href), current = window.location;
      if (destination.origin !== current.origin || (destination.pathname === current.pathname && destination.search === current.search)) return;
      event.preventDefault(); event.stopPropagation();
      requestNavigation(() => router.push(destination.pathname + destination.search + destination.hash));
    };
    // Guard browser history before popstate; first-save URL replacement is allowed.
    const navigation = (window as unknown as { navigation?: EventTarget })
      .navigation;
    const traverse = (event: Event) => {
      const entry = event as Event & {
        navigationType?: string;
        destination?: { url: string };
      };
      if (
        leaving.current ||
        !guardState.current.dirty || guardState.current.readOnly ||
        !entry.cancelable ||
        entry.navigationType !== 'traverse' ||
        !entry.destination ||
        entry.destination.url === window.location.href
      )
        return;
      entry.preventDefault();
      const url = entry.destination.url;
      requestNavigation(() => window.location.assign(url));
    };
    window.addEventListener(NAVIGATION_INTENT_EVENT, intent);
    window.document.addEventListener('click', link, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener(NAVIGATION_INTENT_EVENT, intent);
      window.document.removeEventListener('click', link, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, [router]);
  const commit = useCallback((next: EditorDocument) => {
    setHistory((previous) =>
      JSON.stringify(previous.present) === JSON.stringify(next)
        ? previous
        : {
            present: next,
            past: [...previous.past.slice(-49), previous.present],
            future: [],
          },
    );
    setError('');
    setMessage('');
    setShowTest(false);
  }, []);
  const updateDraft = (next: WorkflowDraft) =>
    commit({ ...document, draft: next });
  const undo = useCallback((redo = false) => {
    setHistory((previous) => {
      if (redo)
        return previous.future.length
          ? {
              present: previous.future[0],
              past: [...previous.past, previous.present],
              future: previous.future.slice(1),
            }
          : previous;
      return previous.past.length
        ? {
            present: previous.past[previous.past.length - 1],
            past: previous.past.slice(0, -1),
            future: [previous.present, ...previous.future],
          }
        : previous;
    });
    setSelected(null);
    setPending(null);
    setError('');
    setMessage('');
    setShowTest(false);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPending(null);
        setInsertAt(null);
      }
      if (
        locked ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'z' ||
        (event.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      event.preventDefault();
      undo(event.shiftKey);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [locked, undo]);
  function select(step: StepSelection) {
    focusOrigin.current = window.document.activeElement as HTMLElement;
    setSelected(step);
    setShowLibrary(false);
  }
  function closeInspector() {
    setSelected(null);
    focusOrigin.current?.focus();
  }
  function applyTrigger(type: string) {
    const next = triggers.find((entry) => entry.type === type);
    if (!next) return;
    const changedEntity = trigger?.entity !== next.entity;
    const indices = draft.actions
      .map((action, index) =>
        definitions.some(
          (def) =>
            def.type === action.type && workflowActionAllowed(next.type, action.type),
        )
          ? index
          : -1,
      )
      .filter((index) => index !== -1);
    commit({
      draft: {
        ...draft,
        trigger: type,
        ...(changedEntity
          ? {
              conditions: { operator: 'AND', conditions: [] },
              actions: indices.map((index) => draft.actions[index]),
            }
          : {}),
      },
      actionIds: changedEntity
        ? indices.map((index) => document.actionIds[index])
        : document.actionIds,
    });
    setChangeTrigger(null);
    select('trigger');
  }
  function place(item: DragItem, target: Placement) {
    if (locked || !canPlace(item, target, document, triggers, definitions))
      return;
    setPending(null);
    setInsertAt(null);
    setShowLibrary(false);
    if (item.kind === 'trigger') {
      const next = triggers.find((entry) => entry.type === item.type);
      if (
        trigger &&
        next?.entity !== trigger.entity &&
        (draft.actions.length || draft.conditions?.conditions.length)
      ) {
        setSelected(null);
        setChangeTrigger(item.type);
      } else applyTrigger(item.type);
    } else if (item.kind === 'condition') {
      const field =
        trigger?.fields.find((entry) => entry.field === item.field) ??
        trigger?.fields[0];
      updateDraft({
        ...draft,
        conditions: {
          operator: draft.conditions?.operator ?? 'AND',
          conditions: [
            ...(draft.conditions?.conditions ?? []),
            newWorkflowCondition(field),
          ],
        },
      });
      select('conditions');
    } else if (item.kind === 'move' && target.kind === 'action') {
      commit(moveAction(document, item.id, target.index));
      setMessage('Action order updated.');
    } else if (item.kind === 'action' && target.kind === 'action') {
      const id = crypto.randomUUID();
      commit(
        insertAction(
          document,
          { type: item.type, config: item.type === 'create_task' && trigger?.entity === 'account' ? { assignmentTarget: { type: 'user', id: '' } } : {} },
          target.index,
          id,
        ),
      );
      select(`action:${id}`);
    }
  }
  function choose(item: LibraryItem) {
    if (locked) return;
    if (item.kind !== 'action') place(item, { kind: item.kind });
    else if (insertAt !== null)
      place(item, { kind: 'action', index: insertAt });
    else {
      setPending(item);
      setSelected(null);
      setShowLibrary(false);
      setMessage('Choose a highlighted insertion position on the canvas.');
    }
  }
  function endDrag(event: DragEndEvent) {
    const item = event.active.data.current?.item as DragItem | undefined;
    const target = event.over?.data.current?.target as Placement | undefined;
    setDragging(null);
    if (!mobile && !locked && item && target) place(item, target);
  }
  function reportError(message: string) {
    setError(message);
  }
  async function submit(activate: boolean, validateOnly = false, confirmed = false) {
    if (operation.current || readOnly || (activate && !canActivate) || (validateOnly && !canExecute)) return;
    setError('');
    setMessage('');
    if (nameIssue || descriptionIssue) {
      select('details');
      if (confirmed) throw new Error(nameIssue || descriptionIssue);
      reportError(nameIssue || descriptionIssue || 'Review the workflow details.');
      return;
    }
    const local = [...editorIssues(
      document,
      triggers,
      definitions,
      options,
      !activate && !validateOnly,
      savedId && savedStatus !== 'DRAFT' ? saved.conditions : undefined,
      savedId ? saved.actions : undefined,
    ), ...workflowTemplateSetupIssues(draft, linkedTemplate?.id, options).map(message => ({ step: 'conditions' as const, message }))];
    if (local.length) {
      select(local[0].step);
      if (confirmed) throw new Error(local[0].message);
      reportError(local[0].message);
      return;
    }
    const parsed = (savedId && draft.description === saved.description ? StoredWorkflowDraftSchema : WorkflowDraftSchema).safeParse({
      ...toDraft(draft),
      isActive: activate,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Review the workflow.';
      if (confirmed) throw new Error(issue);
      reportError(issue);
      return;
    }
    if (activate && !confirmed) {
      closeInspector();
      setConfirmActivation(true);
      return;
    }
    operation.current = true;
    setBusy(true);
    try {
      if (validateOnly) {
        const result = (await workflowsApi.validate(parsed.data, savedId)).data;
        if (!result.valid) throw new Error(result.message || 'Review the workflow configuration.');
        setMessage(result.message);
        toast.success(result.message);
      }
      else {
        const result = await onSave(parsed.data),
          persisted = result ? toDraft(result) : { ...parsed.data, isActive: activate || saved.isActive };
        const paused = !persisted.isActive && (result?.status === 'PAUSED' || saved.isActive || savedStatus === 'PAUSED');
        setSaved(persisted);
        setSavedStatus(result?.status ?? (persisted.isActive ? 'ACTIVE' : paused ? 'PAUSED' : 'DRAFT'));
        if (result) { setSavedId(result.id); setSavedVersion(result.version); }
        setHistory({
          present: { ...document, draft: persisted },
          past: [],
          future: [],
        });
        setMessage(
          !activate && persisted.isActive
            ? 'Draft saved. The published version remains active.'
            : persisted.isActive
            ? 'Published and active. New CRM events use this version.'
            : paused ? 'Changes saved. This workflow is paused.' : 'Draft saved. This workflow is inactive.',
        );
        toast.success(!activate && persisted.isActive ? 'Draft saved; published version remains active.' : persisted.isActive ? 'Workflow published.' : paused ? 'Workflow saved and paused.' : 'Draft saved.');
      }
    } catch (failure) {
      if (confirmed) throw failure;
      reportError(
        failure instanceof Error ? failure.message : 'Unable to save workflow.',
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function pause() {
    if (!onPause || operation.current || !canPause) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await onPause();
      setSaved(toDraft(result));
      setSavedStatus('PAUSED');
      setHistory((previous) => ({
        ...previous,
        present: {
          ...previous.present,
          draft: { ...previous.present.draft, isActive: false },
        },
      }));
      setMessage(
        'Workflow paused. Remaining actions will be skipped; an already dispatched action cannot be recalled.',
      );
      toast.success('Workflow paused.');
    } catch (failure) {
      reportError(
        failure instanceof Error
          ? failure.message
          : 'Unable to pause workflow.',
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  const inspector = selected && (
    <div ref={inspectorRef} className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">
          {selected === 'details'
            ? 'Workflow details'
            : selected === 'trigger'
              ? 'Trigger'
              : selected === 'conditions'
                ? 'Conditions'
                : (definitions.find(
                    (def) => def.type === draft.actions[actionIndex]?.type,
                  )?.label ?? retiredActionLabels[draft.actions[actionIndex]?.type] ?? 'Unavailable action')}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Close configuration"
          onClick={closeInspector}
        >
          <X size={16} />
        </Button>
      </div>
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {selected === 'details' && (
          <>
            <label className="block space-y-2 text-sm">
              <span>Workflow name <span className="text-red-500" aria-hidden="true">*</span></span>
              <Input
                aria-label="Workflow name"
                placeholder="Enter workflow name..."
                aria-required="true"
                aria-invalid={!!nameIssue}
                aria-describedby={
                  nameIssue ? 'workflow-name-error' : undefined
                }
                value={draft.name}
                onChange={(event) =>
                  updateDraft({ ...draft, name: event.target.value })
                }
              />
              {nameIssue && (
                <span
                  id="workflow-name-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {nameIssue}
                </span>
              )}
              {nameCheck?.name === draft.name && nameCheck.failed && !nameIssue && <span className="block text-xs text-[var(--muted-foreground)]">Name availability will be checked when you save.</span>}
            </label>
            <label className="block space-y-2 text-sm">
              Description
              <Textarea
                className={workflowControl}
                rows={4}
                aria-label="Workflow description"
                aria-invalid={!!descriptionIssue}
                aria-describedby={descriptionIssue ? 'workflow-description-error' : undefined}
                placeholder="Describe what this workflow does..."
                value={draft.description ?? ''}
                onChange={(event) =>
                  updateDraft({ ...draft, description: event.target.value })
                }
              />
              {descriptionIssue && <span id="workflow-description-error" role="alert" className="block text-xs text-destructive">{descriptionIssue}</span>}
            </label>
          </>
        )}
        {selected === 'trigger' && (
          <>
            <label className="block space-y-2 text-sm">
              Start when
              <select
                className={workflowControl}
                value={draft.trigger}
                onChange={(event) =>
                  place(
                    { kind: 'trigger', type: event.target.value },
                    { kind: 'trigger' },
                  )
                }
              >
                <option value="">Choose a trigger</option>
                {triggers.map((entry) => (
                  <option key={entry.type} value={entry.type}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {selected === 'conditions' && (
          <>
            {linkedTemplate && <WorkflowTemplateFields draft={draft} templateIdentity={linkedTemplate.id} options={options} onChange={patch => updateDraft(bindWorkflowTemplate(draft, linkedTemplate.id, options, patch))} onDetach={() => setTemplateDetached(true)} />}
            <ConditionFields
              value={draft.conditions ?? { operator: 'AND', conditions: [] }}
              trigger={trigger}
              options={options}
              previousConditions={savedId && savedStatus !== 'DRAFT' ? saved.conditions : undefined}
              onChange={(conditions) => updateDraft({ ...draft, conditions })}
            />
          </>
        )}
        {actionIndex >= 0 && (
          <>
            <label className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
              <input
                type="checkbox"
                checked={draft.actions[actionIndex].enabled !== false}
                onChange={(event) =>
                  updateDraft({
                    ...draft,
                    actions: draft.actions.map((action, index) =>
                      index === actionIndex
                        ? { ...action, enabled: event.target.checked }
                        : action,
                    ),
                  })
                }
              />
              Action enabled
            </label>
            <ActionFields
              key={document.actionIds[actionIndex]}
              action={draft.actions[actionIndex]}
              previous={savedId ? saved.actions[actionIndex] : undefined}
              definition={definitions.find(
                (def) => def.type === draft.actions[actionIndex].type,
              )}
              entity={trigger?.entity}
              options={options}
              stageSetup={linkedTemplate && ['pipeline-routing', 'related-deal-routing'].includes(linkedTemplate.setup) ? <WorkflowTemplateFields draft={draft} templateIdentity={linkedTemplate.id} options={options} onChange={patch => updateDraft(bindWorkflowTemplate(draft, linkedTemplate.id, options, patch))} onDetach={() => setTemplateDetached(true)} /> : undefined}
              onChange={(config) =>
                updateDraft({
                  ...draft,
                  actions: draft.actions.map((action, index) =>
                    index === actionIndex ? { ...action, config } : action,
                  ),
                })
              }
            />
          </>
        )}
      </fieldset>
      {issues.filter((issue) => issue.step === selected).length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {issues
            .filter((issue) => issue.step === selected)
            .map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
        </ul>
      )}
      <Button onClick={closeInspector}>
        Done
      </Button>
    </div>
  );
  const library = (
    <WorkflowLibrary
      triggers={triggers}
      actions={definitions}
      trigger={trigger}
      disabled={locked}
      insertAt={insertAt}
      dragEnabled={!mobile}
      onChoose={choose}
    />
  );
  return (
    <div
      className="flex min-w-0 flex-col bg-[var(--background)] text-[var(--text-primary)]"
      style={{ height: 'calc(100dvh - 80px)', minHeight: 640 }}
    >
      <header className="space-y-3 border-b border-[var(--border)] bg-[var(--card)] p-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              aria-label="Back to workflows"
              disabled={busy}
              onClick={() => requestNavigation(onClose)}
            >
              <ArrowLeft size={18} />
            </Button>
            <div className="min-w-0 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => select('details')}
                className="max-w-full truncate rounded text-left text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {draft.name || 'New workflow'}
              </button>
              <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-[var(--muted-foreground)] sm:block">
                <span className="inline-flex shrink-0 items-center whitespace-nowrap sm:inline">
                  <StatusBadge label={savedStatus === 'ACTIVE' ? 'Active' : savedStatus === 'PAUSED' ? 'Paused' : 'Draft'} variant={savedStatus === 'ACTIVE' ? 'success' : savedStatus === 'PAUSED' ? 'warn' : 'neutral'} />{savedVersion ? ` · v${savedVersion}` : ''}
                </span>{' '}
                <span className="whitespace-nowrap">
                  ·{' '}
                  {dirty
                    ? 'Unsaved changes'
                    : savedId
                      ? 'All changes saved'
                      : 'Not saved yet'}
                </span>
              </p>
            </div>
          </div>
          {savedId && <WorkflowVersionHistory workflowId={savedId} version={savedVersion} dirty={dirty} options={options} onRestore={readOnly ? undefined : onRestoreVersion} />}
          {(!readOnly || canPause && saved.isActive) && (
            <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              {!readOnly && canExecute && <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void submit(false, true)}
              >
                Validate
              </Button>}
              {canPause && saved.isActive && onPause ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="order-last col-span-2 sm:order-none"
                  disabled={busy}
                  onClick={() => void pause()}
                >
                  Pause
                </Button>
              ) : null}
              {!readOnly && <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void submit(false)}
              >
                Save draft
              </Button>}
              {!readOnly && canActivate && (
                <Button
                  size="sm"
                  className="col-span-2"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  {busy
                    ? 'Working…'
                    : saved.isActive
                      ? 'Publish changes'
                      : 'Publish workflow'}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex w-full min-w-0 flex-wrap gap-1 sm:w-auto sm:flex-nowrap">
            <Button
              variant={view === 'builder' ? 'secondary' : 'ghost'}
              size="sm"
              className="px-2 sm:px-3"
              onClick={() => setView('builder')}
            >
              <PanelLeft size={15} />
              Builder
            </Button>
            <Button
              variant={view === 'activity' ? 'secondary' : 'ghost'}
              size="sm"
              className="px-2 sm:px-3"
              onClick={() => setView('activity')}
            >
              <Activity size={15} />
              Activity
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 sm:ml-0"
              onClick={() => select('details')}
              aria-label="Workflow details"
            >
              <Settings2 size={15} />
            </Button>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-1 sm:w-auto sm:flex-nowrap">
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={locked || !history.past.length}
              onClick={() => undo()}
              aria-label="Undo"
            >
              <Undo2 size={16} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={locked || !history.future.length}
              onClick={() => undo(true)}
              aria-label="Redo"
            >
              <Redo2 size={16} />
            </Button>
            {canExecute && <Button
              size="sm"
              variant="outline"
              className="ml-auto shrink-0 sm:ml-0"
              disabled={busy || !savedId || dirty || !trigger}
              title={
                !savedId || dirty
                  ? 'Save changes before testing'
                  : 'Check the saved workflow without executing actions'
              }
              onClick={() => { setSelected(null); setShowLibrary(false); setShowTest(true); }}
            >
              <FlaskConical size={15} />
              Test draft
            </Button>}
          </div>
        </div>
      </header>
      {mobile && view === 'builder' && <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">Tap each step to configure it. Use Add steps to insert steps and the arrow buttons to reorder actions.</p>}
      {retiredAccountWorkflowReferences(draft).length > 0 && <p role="alert" className="border-b border-border px-5 py-3 text-sm text-destructive">{ACCOUNT_RETIREMENT_REASON}</p>}
      {dirty && savedId && <p className="border-b border-[var(--border)] px-5 py-2 text-sm text-[var(--muted-foreground)]">Testing uses the last saved draft. Save changes before running the check.</p>}
      {error && (
        <p
          role="alert"
          className="border-b border-[var(--border)] bg-red-50 px-5 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-b border-[var(--border)] px-5 py-2 text-sm">
          {message}
        </p>
      )}
      {saved.isActive && dirty && (
        <p className="border-b border-[var(--border)] px-5 py-2 text-xs text-[var(--muted-foreground)]">
          The published version stays active until you publish these changes.
        </p>
      )}
      {(pending || insertAt !== null) && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--primary)]/20 bg-[var(--primary)]/5 px-5 py-2 text-sm">
          <span>
            {pending
              ? 'Choose an insertion position.'
              : `Choose an action to insert at position ${insertAt! + 1}.`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive dark:text-destructive dark:hover:text-destructive"
            onClick={() => {
              setPending(null);
              setInsertAt(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {view === 'activity' ? (
        <section aria-label="Workflow activity" className="min-h-0 flex-1 overflow-auto p-5">
          {savedId ? (
            canViewRuns ? <WorkflowRuns workflowId={savedId} /> : <p className="text-sm text-muted-foreground">Run history requires permission to view workflow runs.</p>
          ) : (
            <p>Save this workflow to see its execution activity.</p>
          )}
        </section>
      ) : (
        <DndContext
          accessibility={{
            screenReaderInstructions: {
              draggable:
                'Drag with a pointer. To use the keyboard, choose Add in the library, choose an insertion position, or use an action’s Move up and Move down controls.',
            },
          }}
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(event) => {
            setPending(null);
            setDragging(event.active.data.current?.item as DragItem);
          }}
          onDragCancel={() => setDragging(null)}
          onDragEnd={endDrag}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
            {wide ? (
              <aside className="w-72 shrink-0 overflow-y-auto border-r border-[var(--border)]">
                {library}
              </aside>
            ) : (
              <div className="border-b border-[var(--border)] p-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => setShowLibrary(true)}
                >
                  <PanelLeft size={16} />
                  Add steps
                </Button>
              </div>
            )}
            <WorkflowCanvas
              document={document}
              triggers={triggers}
              actions={definitions}
              options={options}
              selected={selected}
              issues={issues}
              item={dragging ?? pending}
              locked={locked}
              dragEnabled={!mobile}
              onSelect={select}
              onPlace={(target) => {
                if (pending) place(pending, target);
              }}
              onAdd={(index) => {
                setInsertAt(index);
                setSelected(null);
                setShowLibrary(true);
              }}
              onMove={(id, boundary) =>
                commit(moveAction(document, id, boundary))
              }
              onDuplicate={(index) => {
                const id = crypto.randomUUID();
                commit(
                  insertAction(document, draft.actions[index], index + 1, id),
                );
                select(`action:${id}`);
              }}
              onRemove={(index) => {
                commit({
                  draft: {
                    ...draft,
                    actions: draft.actions.filter((_, i) => i !== index),
                  },
                  actionIds: document.actionIds.filter((_, i) => i !== index),
                });
                if (actionIndex === index) setSelected(null);
                setMessage('Action removed. Use Undo to restore it.');
              }}
            />
            {wide && inspector && (
              <aside
                aria-label="Step configuration"
                className="w-80 shrink-0 overflow-y-auto border-l border-[var(--border)]"
              >
                {inspector}
              </aside>
            )}
          </div>
          {!wide && showLibrary && (
            <WorkflowDialog
              sidePanel
              title="Add a workflow step"
              onClose={() => setShowLibrary(false)}
            >
              {library}
            </WorkflowDialog>
          )}
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="rounded-xl border border-[var(--primary)] bg-[var(--card)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-lg">
                {dragging.kind === 'move'
                  ? 'Move action'
                  : dragging.kind === 'condition'
                    ? 'Condition'
                    : dragging.kind === 'trigger'
                      ? triggers.find((entry) => entry.type === dragging.type)
                          ?.label
                      : definitions.find(
                          (entry) => entry.type === dragging.type,
                        )?.label}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
      {inspector && (!wide || view === 'activity') && (
        <WorkflowDialog
          sidePanel
          title="Step configuration"
          onClose={closeInspector}
        >
          {inspector}
        </WorkflowDialog>
      )}
      {canExecute && showTest && savedId && trigger && !dirty && (
        <WorkflowDialog
          title="Test saved draft"
          onClose={() => setShowTest(false)}
        >
          <WorkflowTestPanel workflowId={savedId} trigger={trigger} />
        </WorkflowDialog>
      )}
      {changeTrigger && (
        <ConfirmActionDialog open onOpenChange={open => { if (!open) setChangeTrigger(null); }}
          title="Change workflow record type?" variant="warning" confirmLabel="Change trigger" cancelLabel="Keep current trigger"
          onConfirm={() => applyTrigger(changeTrigger)}>
          <p>This clears {draft.conditions?.conditions.length ?? 0} condition rules and removes {draft.actions.filter(action => !workflowActionAllowed(changeTrigger!, action.type)).length} incompatible actions. Compatible actions are kept. Review their configuration before saving.</p>
        </ConfirmActionDialog>
      )}
      <ConfirmActionDialog open={confirmActivation} onOpenChange={setConfirmActivation}
        title={saved.isActive ? 'Save changes to active workflow?' : 'Activate workflow?'}
        description={`${draft.name} will run when ${trigger?.label ?? 'its trigger'} occurs and its conditions match. ${draft.actions.filter(action => action.enabled !== false).length} enabled action(s) may create tasks, update records, or send messages.`}
        warning="Review recipients, assigned agents, and field changes before activating. Already dispatched actions cannot be recalled."
        variant="success" confirmLabel={saved.isActive ? "Publish changes" : "Activate workflow"} cancelLabel="Keep editing" isLoading={busy}
        confirmDisabled={readOnly || !canActivate} onConfirm={() => submit(true, false, true)} />
      <ConfirmActionDialog open={!!exit} onOpenChange={open => { if (!open) { exitPending.current = false; setExit(null); } }}
        title="Discard unsaved changes?" description="Your last saved workflow will be kept."
        variant="warning" confirmLabel="Discard changes" cancelLabel="Keep editing"
        onConfirm={() => { const navigate = exit; if (!navigate || leaving.current) return; leaving.current = true; exitPending.current = false; setSaved(toDraft(draft)); return navigate(); }} />
    </div>
  );
}
