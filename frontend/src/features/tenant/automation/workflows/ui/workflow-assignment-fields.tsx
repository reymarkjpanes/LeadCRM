'use client';
import type { WorkflowAction, WorkflowAssignmentTarget, WorkflowOptions } from '@leadcrm/shared';
import { assignmentChoices, assignmentSelection } from '../services/workflow-assignment';
import { WorkflowAssignmentSettings } from './workflow-assignment-settings';

export function WorkflowAssignmentFields({ action, options, className, entity, onChange }: {
  action: WorkflowAction; options: WorkflowOptions; className: string; entity?: string; onChange: (config: Record<string, unknown>) => void;
}) {
  const target = assignmentSelection(action);
  const choices = assignmentChoices(action, options);
  const selected = target.type === 'record_owner' ? undefined : choices.find(choice => choice.id === target.id);
  const change = (assignmentTarget: WorkflowAssignmentTarget) => {
    const config = { ...action.config };
    delete config[action.type === 'create_task' ? 'assignedUserId' : 'userId'];
    onChange({ ...config, assignmentTarget });
  };
  const pool = target.type === 'role' || target.type === 'group';
  const label = target.type === 'role' ? 'Role' : target.type === 'group' ? 'Group' : 'User';
  return <fieldset className="min-w-0 space-y-3">
    <legend className="sr-only">Assignment</legend>
    <label className="block space-y-1">Assign to
      <select aria-label="Assign to" className={className} value={target.type} onChange={event => {
        const type = event.target.value as WorkflowAssignmentTarget['type'];
        change(type === 'record_owner' ? { type } : type === 'user' ? { type, id: '' } : { type, id: '', strategy: 'round_robin' });
      }}>
        {action.type === 'create_task' && <option value="record_owner">Current Record Agent</option>}
        <option value="user">Specific User</option><option value="role">Role</option><option value="group">Group</option>
      </select>
    </label>
    {target.type !== 'record_owner' && <label className="block space-y-1">{label}
      <select aria-label={`Assignment ${label.toLowerCase()}`} className={className} value={target.id} onChange={event => change({ ...target, id: event.target.value })}>
        <option value="">Choose {label.toLowerCase()}</option>
        {target.id && !selected && <option value={target.id}>{label} unavailable</option>}
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      </select>
    </label>}
    {target.type !== 'record_owner' && target.id && !selected && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">This assignment target is unavailable. Choose another before activating.</p>}
    {selected?.eligibleMemberCounts && <p className="text-xs text-[var(--muted-foreground)]">{selected.memberCount} members · {selected.eligibleMemberCounts[action.type === 'create_task' ? 'task_assignee' : 'crm_owner']} eligible</p>}
    {pool && <WorkflowAssignmentSettings target={target} entity={entity} task={action.type === 'create_task'} className={className} onChange={change} members={(selected?.members ?? []).filter(member => member.purposes.includes(action.type === 'create_task' ? 'task_assignee' : 'crm_owner'))} />}
    {target.type === 'record_owner' && <p className="text-xs text-[var(--muted-foreground)]">The current record agent must be active and have Tasks access when this action runs.</p>}
  </fieldset>;
}
