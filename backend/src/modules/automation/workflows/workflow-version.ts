import { WorkflowActionSchema, normalizeWorkflowAssignment, type WorkflowDraft } from '@leadcrm/shared';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function workflowDefinitionChanged(before: { trigger: string; conditions?: unknown; actions: unknown }, after: WorkflowDraft): boolean {
  const definition = (draft: typeof before) => ({ trigger: draft.trigger, conditions: draft.conditions ?? null,
    actions: Array.isArray(draft.actions) ? draft.actions.map(action => {
      const parsed = WorkflowActionSchema.safeParse(action);
      // Invalid historical actions must remain replaceable through an explicit edit.
      return parsed.success ? { ...normalizeWorkflowAssignment(parsed.data), enabled: parsed.data.enabled !== false } : action;
    }) : draft.actions });
  return stable(definition(before)) !== stable(definition(after));
}
