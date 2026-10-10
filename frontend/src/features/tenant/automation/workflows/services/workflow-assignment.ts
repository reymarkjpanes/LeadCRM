import { workflowAssignmentTarget, WorkflowAssignmentTargetSchema, WorkflowAssignmentStrategySchema, WORKFLOW_ASSIGNMENT_METHODS, type WorkflowAction, type WorkflowAssignmentTarget, type WorkflowOptions, type WorkflowAssignmentPoolOption } from '@leadcrm/shared';

export function assignmentSelection(action: WorkflowAction): WorkflowAssignmentTarget {
  const target = workflowAssignmentTarget(action);
  if (target && typeof target === 'object' && 'type' in target) {
    if (target.type === 'record_owner') return { type: 'record_owner' };
    const id = 'id' in target && typeof target.id === 'string' ? target.id : '';
    if (target.type === 'user') return { type: 'user', id };
    if (target.type === 'role' || target.type === 'group') return { ...target, type: target.type, id, strategy: WorkflowAssignmentStrategySchema.safeParse('strategy' in target ? target.strategy : undefined).data ?? 'round_robin' } as WorkflowAssignmentTarget;
  }
  return { type: 'user', id: '' };
}
export function assignmentChoices(action: WorkflowAction, options: WorkflowOptions): Array<{ id: string; name: string; memberCount?: number; eligibleMemberCounts?: WorkflowAssignmentPoolOption['eligibleMemberCounts']; members?: WorkflowAssignmentPoolOption['members'] }> {
  const target = assignmentSelection(action);
  return target.type === 'role' ? options.roles ?? [] : target.type === 'group' ? options.groups ?? []
    : action.type === 'create_task' ? options.taskAssignees ?? options.users : options.users;
}
export function assignmentSummary(action: WorkflowAction, options: WorkflowOptions) {
  const target = assignmentSelection(action);
  if (target.type === 'record_owner') return 'current record agent';
  const name = assignmentChoices(action, options).find(choice => choice.id === target.id)?.name;
  if (!name) return target.id ? `${target.type === 'user' ? 'User' : target.type === 'role' ? 'Role' : 'Group'} unavailable` : 'choose an assignment target';
  return target.type === 'user' ? name : `${target.type === 'role' ? 'Role' : 'Group'} · ${name} · ${WORKFLOW_ASSIGNMENT_METHODS[target.strategy]}`;
}
export function assignmentIssues(action: WorkflowAction, options: WorkflowOptions, incomplete: boolean): string[] {
  const raw = workflowAssignmentTarget(action);
  const target = assignmentSelection(action);
  if (incomplete && (raw === undefined || ('id' in target && !target.id))) return [];
  const parsed = WorkflowAssignmentTargetSchema.safeParse(raw);
  if (!parsed.success) return [parsed.error.issues[0]?.message ?? 'Choose a valid user, role or group for assignment.'];
  if (target.type === 'record_owner') return action.type === 'create_task' ? [] : ['Assign Agent requires a user, role or group.'];
  const selected = assignmentChoices(action, options).find(choice => choice.id === target.id);
  if (!selected) return ['Assignment target unavailable. Choose an available selection.'];
  if (selected.eligibleMemberCounts && selected.eligibleMemberCounts[action.type === 'create_task' ? 'task_assignee' : 'crm_owner'] === 0)
    return [`${selected.name} has no eligible members for this assignment.`];
  return [];
}
