'use client';
import { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Search, Zap, GitBranch, Play } from 'lucide-react';
import type { ActionDefinition, TriggerDefinition } from '@leadcrm/shared';
import { workflowActionAllowed } from '@leadcrm/shared';
import { Input } from '@/shared/components/ui/input';
import { matchesSearch } from '@/shared/utils/search';
import { isSelectableWorkflowConditionField, type LibraryItem } from '../services/workflow-editor';

export const stepIcons = { trigger: Zap, condition: GitBranch, action: Play };
export const stepColors = {
  trigger: 'text-[var(--primary)] bg-[var(--primary)]/10',
  condition:
    'text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-950',
  action: 'text-teal-700 bg-teal-100 dark:text-teal-300 dark:bg-teal-950',
};
function LibraryCard({
  item,
  title,
  disabled,
  dragEnabled,
  onChoose,
}: {
  item: LibraryItem;
  title: string;
  disabled: boolean;
  dragEnabled: boolean;
  onChoose: (item: LibraryItem) => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `library:${item.kind}:${'type' in item ? item.type : (item.field ?? 'group')}`,
    data: { item },
    disabled: disabled || !dragEnabled,
  });
  const Icon = stepIcons[item.kind];
  return (
    <div
      ref={setNodeRef}
      className={`flex rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        aria-label={`Add ${title}`}
        disabled={disabled}
        onClick={() => onChoose(item)}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-l-xl p-3 text-left hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
      >
        <span className={`rounded-lg p-2 ${stepColors[item.kind]}`}>
          <Icon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
        </span>
      </button>
      {dragEnabled && <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag ${title}`}
        tabIndex={-1}
        className="touch-none rounded-r-xl px-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40"
      >
        <GripVertical size={16} />
      </button>}
    </div>
  );
}
export function WorkflowLibrary({
  triggers,
  actions,
  trigger,
  disabled,
  dragEnabled = true,
  insertAt,
  onChoose,
}: {
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  trigger?: TriggerDefinition;
  disabled: boolean;
  dragEnabled?: boolean;
  insertAt?: number | null;
  onChoose: (item: LibraryItem) => void;
}) {
  const [category, setCategory] = useState<LibraryItem['kind']>(
    trigger ? 'action' : 'trigger',
  );
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (insertAt != null) {
      setCategory('action');
      setSearch('');
    }
  }, [insertAt]);
  const match = (text: string) => matchesSearch(search, text);
  const entries: Array<{
    item: LibraryItem;
    title: string;
  }> =
    category === 'trigger'
      ? triggers
          .filter((entry) => match(entry.label))
          .map((entry) => ({
            item: { kind: 'trigger', type: entry.type },
            title: entry.label,
          }))
      : category === 'condition'
        ? (trigger?.fields ?? [])
            .filter((entry) => isSelectableWorkflowConditionField(entry) && match(entry.label))
            .map((entry) => ({
              item: { kind: 'condition', field: entry.field },
              title: entry.label,
            }))
        : actions
            .filter(
              (entry) =>
                trigger &&
                workflowActionAllowed(trigger.type, entry.type) &&
                match(`${entry.label} ${entry.description}`),
            )
            .map((entry) => ({
              item: { kind: 'action', type: entry.type },
              title: entry.label,
            }));
  return (
    <section aria-label="Builder library" className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">Builder library</h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {dragEnabled ? 'Drag a step, or click to place it.' : 'Tap a step to add it.'}
        </p>
      </div>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-3 text-[var(--muted-foreground)]"
        />
        <Input
          aria-label="Search steps"
          placeholder="Search steps…"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div
        className="flex gap-1 rounded-xl bg-[var(--muted)] p-1"
        role="group"
        aria-label="Step categories"
      >
        {(['trigger', 'condition', 'action'] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            aria-pressed={category === kind}
            onClick={() => setCategory(kind)}
            className={`min-h-10 flex-1 rounded-lg px-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${category === kind ? 'bg-[var(--card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--muted-foreground)]'}`}
          >
            {kind === 'condition'
              ? 'Conditions'
              : kind === 'trigger'
                ? 'Triggers'
                : 'Actions'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <LibraryCard
            key={JSON.stringify(entry.item)}
            {...entry}
            disabled={disabled}
            dragEnabled={dragEnabled}
            onChoose={onChoose}
          />
        ))}
      </div>
      {!entries.length && (
        <p
          role="status"
          className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]"
        >
          {!trigger && category !== 'trigger'
            ? 'Choose a trigger first.'
            : 'No matching steps. Try a different search.'}
        </p>
      )}
    </section>
  );
}
