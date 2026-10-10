'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  Minus,
  Plus,
  Scan,
  Maximize2,
  Trash2,
  Pause,
  AlertCircle,
} from 'lucide-react';
import type {
  ActionDefinition,
  TriggerDefinition,
  WorkflowOptions,
} from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import {
  actionSummary,
  retiredActionLabels,
  conditionSummary,
  canPlace,
  type DragItem,
  type EditorDocument,
  type EditorIssue,
  type Placement,
  type StepSelection,
} from '../services/workflow-editor';
import { stepColors, stepIcons } from './workflow-library';

function DropTarget({
  id,
  target,
  item,
  document,
  triggers,
  actions,
  onPlace,
  children,
}: {
  id: string;
  target: Placement;
  item: DragItem | null;
  document: EditorDocument;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  onPlace: (target: Placement) => void;
  children: ReactNode;
}) {
  const valid = !!item && canPlace(item, target, document, triggers, actions);
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { target },
    disabled: !valid,
  });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl transition-colors ${valid ? `outline outline-2 outline-dashed outline-offset-4 ${isOver ? 'bg-[var(--primary)]/15 outline-[var(--primary)]' : 'outline-[var(--primary)]/50'}` : ''}`}
    >
      {valid ? (
        <button
          type="button"
          onClick={() => onPlace(target)}
          className="w-full rounded-xl p-3 text-sm font-semibold text-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {target.kind === 'trigger'
            ? 'Place trigger here'
            : target.kind === 'condition'
              ? 'Add condition here'
              : `Insert at position ${target.index + 1}`}
        </button>
      ) : null}
      {children}
    </div>
  );
}
function NodeCard({
  kind,
  label,
  summary,
  selected,
  disabled,
  issues,
  compact,
  onSelect,
  children,
}: {
  kind: 'trigger' | 'condition' | 'action';
  label: string;
  summary: string[];
  selected: boolean;
  disabled?: boolean;
  issues: string[];
  compact: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const Icon = stepIcons[kind];
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-[var(--card)] shadow-sm ${selected ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/25' : 'border-[var(--border)]'} ${disabled ? 'border-dashed' : ''}`}
    >
      <button
        type="button"
        aria-label={`Configure ${kind}: ${label}`}
        onClick={onSelect}
        aria-pressed={selected}
        className="w-full p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] hover:bg-[var(--muted)]/40"
      >
        <span className="flex items-center gap-3">
          <span className={`rounded-lg p-2 ${stepColors[kind]}`}>
            <Icon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
              {kind === 'condition' ? 'Condition gate' : kind}
            </span>
            <span className="block break-words text-sm font-semibold">
              {label}
            </span>
          </span>
          {disabled ? (
            <Pause
              aria-label="Disabled"
              size={16}
              className="text-[var(--muted-foreground)]"
            />
          ) : issues.length ? (
            <AlertCircle
              aria-label="Needs configuration"
              size={18}
              className="text-amber-600 dark:text-amber-400"
            />
          ) : (
            <Check
              aria-label="Configured"
              size={16}
              className="text-[var(--muted-foreground)]"
            />
          )}
        </span>
        {!compact && (
          <span className="mt-3 block space-y-1 border-t border-[var(--border)] pt-3">
            {summary.map((line, index) => (
              <span
                key={index}
                className="block break-words text-xs leading-relaxed text-[var(--muted-foreground)]"
              >
                {line}
              </span>
            ))}
          </span>
        )}
        {disabled && (
          <span className="mt-2 block text-xs text-[var(--muted-foreground)]">
            Disabled · skipped during execution
          </span>
        )}
        {!disabled && issues.length > 0 && (
          <span className="mt-2 block text-xs text-amber-700 dark:text-amber-300">
            {issues[0]}
          </span>
        )}
      </button>
      {children}
    </div>
  );
}
function MovableAction({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `action:${id}`,
    data: { item: { kind: 'move', id } },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`relative ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="absolute -left-9 top-4">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          tabIndex={-1}
          aria-label="Drag to reorder action"
          className="touch-none rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:hidden"
        >
          <GripVertical size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}
export function WorkflowCanvas({
  document,
  triggers,
  actions,
  options,
  selected,
  issues,
  item,
  locked,
  onSelect,
  onPlace,
  onAdd,
  onMove,
  onDuplicate,
  onRemove,
}: {
  document: EditorDocument;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  options: WorkflowOptions;
  selected: StepSelection | null;
  issues: EditorIssue[];
  item: DragItem | null;
  locked: boolean;
  onSelect: (step: StepSelection) => void;
  onPlace: (target: Placement) => void;
  onAdd: (index: number) => void;
  onMove: (id: string, boundary: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [compact, setCompact] = useState(false),
    [height, setHeight] = useState(800);
  const viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const trigger = triggers.find(
    (entry) => entry.type === document.draft.trigger,
  );
  useEffect(() => {
    if (!content.current) return;
    const measure = () => setHeight(content.current?.offsetHeight ?? 800);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [document, compact]);
  const center = () =>
    viewport.current?.scrollTo({
      top: 0,
      left: Math.max(
        0,
        (viewport.current.scrollWidth - viewport.current.clientWidth) / 2,
      ),
      behavior: 'auto',
    });
  useEffect(() => {
    center();
  }, [zoom]);
  const issueFor = (step: StepSelection) =>
    issues.filter((issue) => issue.step === step).map((issue) => issue.message);
  const dropProps = { item, document, triggers, actions, onPlace };
  const connector = (
    <div
      className="mx-auto flex h-10 w-px items-end justify-center bg-[var(--border)] text-[var(--muted-foreground)]"
      aria-hidden="true"
    >
      <ArrowDown size={13} className="shrink-0" />
    </div>
  );
  const slot = (index: number) => (
    <DropTarget
      {...dropProps}
      id={`slot:${index}`}
      target={{ kind: 'action', index }}
    >
      <div className="relative flex h-14 justify-center">
        <div className="h-full w-px bg-[var(--border)]" />
        {!locked && !item && (
          <button
            type="button"
            aria-label={`Add step at position ${index + 1}`}
            onClick={() => onAdd(index)}
            disabled={document.draft.actions.length >= 20}
            className="absolute top-3 rounded-full border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </DropTarget>
  );
  return (
    <section
      aria-label="Workflow canvas"
      className="relative flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden bg-[var(--muted)]/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--card)]/80 px-4 py-2 text-xs">
        <span className="text-[var(--muted-foreground)]">
          {document.draft.actions.length}/20 actions ·{' '}
          {trigger?.entity === 'contact'
            ? 'Contacts'
            : trigger?.entity === 'deal'
              ? 'Deals'
              : trigger?.entity === 'account'
                ? 'Accounts'
              : trigger
                ? 'Leads'
                : 'Choose an event'}
        </span>
        <button
          type="button"
          aria-pressed={compact}
          onClick={() => setCompact(!compact)}
          className="rounded-lg px-3 py-2 hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {compact ? 'Expand cards' : 'Compact cards'}
        </button>
      </div>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto overscroll-contain pb-20"
        style={{
          backgroundImage:
            'radial-gradient(var(--border) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div
          className="relative mx-auto"
          style={{ width: 440 * zoom, height: height * zoom }}
        >
          <div
            ref={content}
            className="absolute left-0 top-0 w-[440px] px-12 py-10"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted-foreground)]">
              Workflow starts
            </p>
            <DropTarget
              {...dropProps}
              id="trigger-slot"
              target={{ kind: 'trigger' }}
            >
              <NodeCard
                kind="trigger"
                label={trigger?.label ?? 'Choose a trigger'}
                summary={['A matching CRM event starts this workflow.']}
                selected={selected === 'trigger'}
                compact={compact}
                issues={issueFor('trigger')}
                onSelect={() => onSelect('trigger')}
              />
            </DropTarget>
            {connector}
            <DropTarget
              {...dropProps}
              id="condition-slot"
              target={{ kind: 'condition' }}
            >
              <NodeCard
                kind="condition"
                label={
                  document.draft.conditions?.conditions.length
                    ? `${document.draft.conditions.operator === 'AND' ? 'ALL' : 'ANY'} conditions match`
                    : 'All matching records'
                }
                summary={
                  document.draft.conditions?.conditions.length
                    ? document.draft.conditions.conditions.map((rule) =>
                        conditionSummary(rule, trigger, options),
                      )
                    : ['Optional: filter records before actions run.']
                }
                selected={selected === 'conditions'}
                compact={compact}
                issues={issueFor('conditions')}
                onSelect={() => onSelect('conditions')}
              />
            </DropTarget>
            {!!document.draft.conditions?.conditions.length && (
              <p className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">
                Matched ↓ continue · Not matched → exit
              </p>
            )}
            {document.draft.actions.map((action, index) => (
              <div key={document.actionIds[index]}>
                {slot(index)}
                <MovableAction id={document.actionIds[index]} disabled={locked}>
                  <NodeCard
                    kind="action"
                    label={`${index + 1}. ${actions.find((entry) => entry.type === action.type)?.label ?? retiredActionLabels[action.type] ?? 'Unavailable action'}`}
                    summary={actionSummary(action, options)}
                    disabled={action.enabled === false}
                    selected={
                      selected === `action:${document.actionIds[index]}`
                    }
                    compact={compact}
                    issues={issueFor(`action:${document.actionIds[index]}`)}
                    onSelect={() =>
                      onSelect(`action:${document.actionIds[index]}`)
                    }
                  >
                    {!locked && (
                      <div className="flex justify-end gap-1 border-t border-[var(--border)] px-2 py-1">
                        {[
                          {
                            label: `Move action ${index + 1} up`,
                            icon: ArrowUp,
                            disabled: index === 0,
                            run: () =>
                              onMove(document.actionIds[index], index - 1),
                          },
                          {
                            label: `Move action ${index + 1} down`,
                            icon: ArrowDown,
                            disabled:
                              index === document.draft.actions.length - 1,
                            run: () =>
                              onMove(document.actionIds[index], index + 2),
                          },
                          {
                            label: `Duplicate action ${index + 1}`,
                            icon: Copy,
                            disabled: document.draft.actions.length >= 20,
                            run: () => onDuplicate(index),
                          },
                          {
                            label: `Remove action ${index + 1}`,
                            icon: Trash2,
                            disabled: false,
                            run: () => onRemove(index),
                          },
                        ].map((control) => (
                          <button
                            key={control.label}
                            type="button"
                            aria-label={control.label}
                            title={control.label}
                            disabled={control.disabled}
                            onClick={control.run}
                            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-25"
                          >
                            <control.icon size={15} />
                          </button>
                        ))}
                      </div>
                    )}
                  </NodeCard>
                </MovableAction>
              </div>
            ))}
            {slot(document.draft.actions.length)}
            {!document.draft.actions.length && (
              <div className="mb-5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/70 p-5 text-center">
                <h3 className="text-sm font-medium">
                  What should happen next?
                </h3>
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  Add an action from the library or use the + above.
                </p>
              </div>
            )}
            <div className="mx-auto w-fit rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs text-[var(--muted-foreground)]">
              End
            </div>
          </div>
        </div>
      </div>
      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-sm"
        aria-label="Canvas controls"
      >
        <Button
          size="sm"
          variant="ghost"
          aria-label="Zoom out"
          disabled={zoom <= 0.1}
          onClick={() =>
            setZoom((value) =>
              Math.max(0.1, Math.round((value - 0.1) * 100) / 100),
            )
          }
        >
          <Minus size={16} />
        </Button>
        <span className="min-w-10 text-center text-xs">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Zoom in"
          disabled={zoom >= 1.5}
          onClick={() =>
            setZoom((value) =>
              Math.min(1.5, Math.round((value + 0.1) * 100) / 100),
            )
          }
        >
          <Plus size={16} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Fit workflow to view"
          title="Fit workflow to view"
          onClick={() => {
            if (viewport.current)
              setZoom(
                Math.max(
                  0.05,
                  Math.min(
                    1.5,
                    (viewport.current.clientWidth - 24) / 440,
                    (viewport.current.clientHeight - 80) / height,
                  ),
                ),
              );
            center();
          }}
        >
          <Scan size={16} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Reset and center canvas"
          title="Reset and center canvas"
          onClick={() => {
            setZoom(1);
            center();
          }}
        >
          <Maximize2 size={16} />
        </Button>
      </div>
    </section>
  );
}
