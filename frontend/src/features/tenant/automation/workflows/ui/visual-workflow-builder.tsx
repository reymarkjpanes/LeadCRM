'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
  WorkflowDraftSchema,
  workflowOperators,
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
} from './workflow-fields';
import { WorkflowLibrary } from './workflow-library';
import { WorkflowCanvas } from './workflow-canvas';
import { WorkflowRuns } from './workflow-execution-log-modal';
import { WorkflowTestPanel } from './workflow-test-panel';
import {
  canPlace,
  editorDocument,
  editorIssues,
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

interface Props {
  initial: WorkflowDraft;
  workflowId?: string;
  initialStatus?: Workflow['status'];
  initialVersion?: number;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  options?: WorkflowOptions;
  existingWorkflows?: Array<{ id: string; name: string }>;
  onCheckName?: (name: string, excludeId?: string) => Promise<boolean>;
  canActivate: boolean;
  readOnly?: boolean;
  onSave: (draft: WorkflowDraft) => Promise<Workflow | void>;
  onPause?: () => Promise<Workflow>;
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
  initialStatus,
  initialVersion,
  triggers,
  actions: definitions,
  options = emptyOptions,
  existingWorkflows = [],
  onCheckName,
  canActivate,
  readOnly,
  onSave,
  onPause,
  onClose,
}: Props) {
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
    [exit, setExit] = useState<(() => void) | null>(null);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const operation = useRef(false),
    focusOrigin = useRef<HTMLElement | null>(null),
    leaving = useRef(false);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wide && selected)
      inspectorRef.current
        ?.querySelector<HTMLElement>('input,select,textarea')
        ?.focus();
  }, [selected, wide]);
  const { present: document } = history,
    { draft } = document;
  const trigger = triggers.find((entry) => entry.type === draft.trigger);
  const dirty = JSON.stringify(toDraft(draft)) !== JSON.stringify(saved);
  const locked = !!readOnly || busy;
  const nameIssue = workflowNameIssue(draft.name, existingWorkflows, savedId) ||
    (nameCheck?.name === draft.name && nameCheck.available === false ? 'A workflow with this name already exists. Choose another name.' : '');
  const issues = [
    ...editorIssues(document, triggers, definitions, options, false, savedId && savedStatus !== 'DRAFT' ? saved.conditions : undefined),
    ...(nameIssue && draft.name.trim() ? [{ step: 'details' as const, message: nameIssue }] : []),
  ];
  const actionIndex = selected?.startsWith('action:')
    ? document.actionIds.indexOf(selected.slice(7))
    : -1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (!onCheckName || !draft.name.trim() || readOnly) return;
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
    if (!dirty || readOnly) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const link = (event: MouseEvent) => {
      if (leaving.current) return;
      // Next's router can render before pushState fires. Guard navigation controls
      // at capture time, then replay the user's click only after confirmation.
      const control = (event.target as HTMLElement).closest?.(
        'nav button, [role="navigation"] button, [role="menuitem"]',
      );
      if (control instanceof HTMLElement && !editorRef.current?.contains(control)) {
        event.preventDefault();
        event.stopPropagation();
        setExit(() => () => control.click());
        return;
      }
      const anchor = (event.target as HTMLElement).closest?.('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button !== 0 ||
        anchor.href === window.location.href
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setExit(() => () => window.location.assign(anchor.href));
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
        !entry.cancelable ||
        entry.navigationType !== 'traverse' ||
        !entry.destination ||
        entry.destination.url === window.location.href
      )
        return;
      entry.preventDefault();
      const url = entry.destination.url;
      setExit(() => () => window.location.assign(url));
    };
    window.addEventListener('beforeunload', unload);
    window.document.addEventListener('click', link, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.document.removeEventListener('click', link, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, [dirty, readOnly]);
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
            def.type === action.type && def.entities.includes(next.entity),
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
            {
              field: field?.field ?? '',
              operator: workflowOperators(field?.type ?? 'string')[0],
              value:
                field?.type === 'number'
                  ? 0
                  : field?.type === 'boolean'
                    ? false
                    : '',
            },
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
          { type: item.type, config: {} },
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
    if (item && target) place(item, target);
  }
  function reportError(message: string) {
    setError(message);
    toast.error(message);
  }
  async function submit(activate: boolean, validateOnly = false, confirmed = false) {
    if (operation.current || readOnly || (activate && !canActivate)) return;
    setError('');
    setMessage('');
    if (nameIssue) {
      select('details');
      reportError(nameIssue);
      if (confirmed) throw new Error(nameIssue);
      return;
    }
    const local = editorIssues(
      document,
      triggers,
      definitions,
      options,
      !activate && !validateOnly,
      savedId && savedStatus !== 'DRAFT' ? saved.conditions : undefined,
    );
    if (local.length) {
      select(local[0].step);
      reportError(local[0].message);
      if (confirmed) throw new Error(local[0].message);
      return;
    }
    const parsed = WorkflowDraftSchema.safeParse({
      ...toDraft(draft),
      isActive: activate,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Review the workflow.';
      reportError(issue);
      if (confirmed) throw new Error(issue);
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
          persisted = result ? toDraft(result) : parsed.data;
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
          persisted.isActive
            ? 'Saved and active. Matching CRM events will run this workflow.'
            : paused ? 'Changes saved. This workflow is paused.' : 'Draft saved. This workflow is inactive.',
        );
        toast.success(persisted.isActive ? 'Workflow saved and activated.' : paused ? 'Workflow saved and paused.' : 'Draft saved.');
      }
    } catch (failure) {
      reportError(
        failure instanceof Error ? failure.message : 'Unable to save workflow.',
      );
      if (confirmed) throw failure;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function pause() {
    if (!onPause || operation.current || !canActivate) return;
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
                aria-required="true"
                aria-invalid={!!nameIssue}
                aria-describedby={
                  nameIssue ? 'workflow-name-error' : undefined
                }
                maxLength={255}
                value={draft.name}
                onChange={(event) =>
                  updateDraft({ ...draft, name: event.target.value })
                }
              />
              {nameIssue && (
                <span
                  id="workflow-name-error"
                  className="text-xs text-amber-700 dark:text-amber-300"
                >
                  {nameIssue}
                </span>
              )}
              {nameCheck?.name === draft.name && nameCheck.failed && !nameIssue && <span className="block text-xs text-[var(--muted-foreground)]">Name availability will be checked when you save.</span>}
            </label>
            <label className="block space-y-2 text-sm">
              Description
              <textarea
                className={workflowControl}
                rows={4}
                maxLength={2000}
                value={draft.description ?? ''}
                onChange={(event) =>
                  updateDraft({ ...draft, description: event.target.value })
                }
              />
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
            <p className="text-sm text-[var(--muted-foreground)]">
              A real CRM event starts this workflow on the server. It continues
              when you close the editor.
            </p>
          </>
        )}
        {selected === 'conditions' && (
          <>
            <p className="text-sm text-[var(--muted-foreground)]">
              Check these rules before any action runs. Records that do not
              match exit the workflow.
            </p>
            <ConditionFields
              value={draft.conditions ?? { operator: 'AND', conditions: [] }}
              trigger={trigger}
              options={options}
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
              definition={definitions.find(
                (def) => def.type === draft.actions[actionIndex].type,
              )}
              entity={trigger?.entity}
              options={options}
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
      <p className="text-xs text-[var(--muted-foreground)]">
        Changes update the canvas immediately. Save the workflow to apply them.
      </p>
      <Button variant={selected === 'trigger' || selected === 'conditions' ? 'default' : 'outline'} onClick={closeInspector}>
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
      onChoose={choose}
    />
  );
  return (
    <div
      ref={editorRef}
      className="flex min-w-0 flex-col bg-[var(--background)] text-[var(--text-primary)]"
      style={{ height: 'calc(100dvh - 80px)', minHeight: 640 }}
    >
      <header className="space-y-3 border-b border-[var(--border)] bg-[var(--card)] p-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to workflows"
              disabled={busy}
              onClick={() =>
                dirty && !readOnly ? setExit(() => onClose) : onClose()
              }
            >
              <ArrowLeft size={18} />
            </Button>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => select('details')}
                className="max-w-full truncate rounded text-left text-base font-semibold focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {draft.name || 'New workflow'}
              </button>
              <p className="text-xs text-[var(--muted-foreground)]">
                <StatusBadge label={savedStatus === 'ACTIVE' ? 'Active' : savedStatus === 'PAUSED' ? 'Paused' : 'Draft'} variant={savedStatus === 'ACTIVE' ? 'success' : savedStatus === 'PAUSED' ? 'warn' : 'neutral'} />{savedVersion ? ` · v${savedVersion}` : ''}{' '}
                ·{' '}
                {dirty
                  ? 'Unsaved changes'
                  : savedId
                    ? 'All changes saved'
                    : 'Not saved yet'}
              </p>
            </div>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void submit(false, true)}
              >
                Validate
              </Button>
              {saved.isActive && onPause ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void pause()}
                >
                  Pause
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void submit(false)}
              >
                {saved.isActive ? 'Save and pause' : savedStatus === 'PAUSED' ? 'Save changes' : 'Save draft'}
              </Button>
              {canActivate && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  {busy
                    ? 'Working…'
                    : saved.isActive
                      ? 'Save active workflow'
                      : 'Save and activate'}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button
              variant={view === 'builder' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('builder')}
            >
              <PanelLeft size={15} />
              Builder
            </Button>
            <Button
              variant={view === 'activity' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('activity')}
            >
              <Activity size={15} />
              Activity
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => select('details')}
              aria-label="Workflow details"
            >
              <Settings2 size={15} />
            </Button>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={locked || !history.past.length}
              onClick={() => undo()}
              aria-label="Undo"
            >
              <Undo2 size={16} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={locked || !history.future.length}
              onClick={() => undo(true)}
              aria-label="Redo"
            >
              <Redo2 size={16} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !savedId || dirty || !trigger}
              title={
                !savedId || dirty
                  ? 'Save changes before testing'
                  : 'Check the saved workflow without executing actions'
              }
              onClick={() => setShowTest(true)}
            >
              <FlaskConical size={15} />
              Test
            </Button>
          </div>
        </div>
      </header>
      {dirty && savedId && <p className="border-b border-[var(--border)] px-5 py-2 text-sm text-[var(--muted-foreground)]">Testing uses the last saved version of this workflow. Save changes before running the check.</p>}
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
          The saved version is still active. Save to apply your changes, or
          pause it while editing.
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
            onClick={() => {
              setPending(null);
              setInsertAt(null);
            }}
          >
            Cancel placement
          </Button>
        </div>
      )}
      {view === 'activity' ? (
        <section aria-label="Workflow activity" className="min-h-0 flex-1 overflow-auto p-5">
          {savedId ? (
            <WorkflowRuns workflowId={savedId} />
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
      {showTest && savedId && trigger && !dirty && (
        <WorkflowDialog
          title="Test saved workflow"
          onClose={() => setShowTest(false)}
        >
          <WorkflowTestPanel workflowId={savedId} trigger={trigger} />
        </WorkflowDialog>
      )}
      {changeTrigger && (
        <ConfirmActionDialog open onOpenChange={open => { if (!open) setChangeTrigger(null); }}
          title="Change workflow record type?" variant="warning" confirmLabel="Change trigger" cancelLabel="Keep current trigger"
          onConfirm={() => applyTrigger(changeTrigger)}>
          <p>This clears {draft.conditions?.conditions.length ?? 0} condition rules and removes {draft.actions.filter(action => !definitions.find(def => def.type === action.type)?.entities.includes(triggers.find(entry => entry.type === changeTrigger)!.entity)).length} incompatible actions. Compatible actions are kept. Review their configuration before saving.</p>
        </ConfirmActionDialog>
      )}
      <ConfirmActionDialog open={confirmActivation} onOpenChange={setConfirmActivation}
        title={saved.isActive ? 'Save changes to active workflow?' : 'Activate workflow?'}
        description={`${draft.name} will run when ${trigger?.label ?? 'its trigger'} occurs and its conditions match. ${draft.actions.filter(action => action.enabled !== false).length} enabled action(s) may create tasks, update records, or send messages.`}
        warning="Review recipients, assigned agents, and field changes before activating. Already dispatched actions cannot be recalled."
        variant="success" confirmLabel="Confirm activation" cancelLabel="Keep editing" isLoading={busy}
        confirmDisabled={readOnly || !canActivate} onConfirm={() => submit(true, false, true)} />
      <ConfirmActionDialog open={!!exit} onOpenChange={open => { if (!open) setExit(null); }}
        title="Discard unsaved changes?" description="Your last saved workflow will be kept."
        variant="warning" confirmLabel="Discard changes" cancelLabel="Keep editing"
        onConfirm={() => { leaving.current = true; setSaved(toDraft(draft)); exit?.(); }} />
    </div>
  );
}
