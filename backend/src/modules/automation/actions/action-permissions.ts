import { getWorkflowConditionFields, getWorkflowUpdateFields, workflowAssignmentTarget, WorkflowAssignmentTargetSchema, type WorkflowDraft } from '@leadcrm/shared';
import { findUser } from './actions.repository';
import { assertPermissions } from '../../../core/permissions/permission.service';
import type { PermissionKey } from '../../../shared/constants/permissions';
import { AppError } from '../../../shared/errors/app-error';
import { findTrigger } from '../triggers/trigger-catalog';

export async function assertAssignmentReferencePermissions(draft: WorkflowDraft, tenantId: string, userId: string) {
  const required: PermissionKey[] = [];
  for (const action of draft.actions) {
    if (!['create_task', 'assign_owner'].includes(action.type)) continue;
    const target = workflowAssignmentTarget(action);
    if (!target || typeof target !== 'object' || !('type' in target)) continue;
    if (target.type === 'role') required.push('roles.view');
    if (target.type === 'group') required.push('groups.view');
  }
  if (!required.length) return;
  const user = await findUser(userId, tenantId);
  if (!user) throw new AppError('Workflow author is unavailable.', 403);
  await assertPermissions({ userId, tenantId, role: user.role }, required);
}

/** Reuse the same active assignments and flag mapping as the HTTP RBAC guard. */
export async function assertWorkflowPermissions(draft: WorkflowDraft, tenantId: string, userId: string) {
  const user = await findUser(userId, tenantId);
  if (!user || user.role.trim().toLowerCase() === 'guest') throw new AppError('Workflow author is unavailable.', 403);
  const entity = findTrigger(draft.trigger)?.entity;
  const required: PermissionKey[] = ['workflows.activate', entity === 'deal' ? 'deals.view' : entity === 'account' ? 'accounts.view' : entity === 'lead' ? 'leads.view' : 'contacts.view'];
  const referencePermissions = { user: 'users.view', products: 'products.view', account: 'accounts.view', contacts: 'contacts.view', leads: 'leads.view', stage: 'deals.view', pipeline: 'deals.view' } as const;
  if (entity) for (const rule of draft.conditions?.conditions ?? []) {
    const field = getWorkflowConditionFields(entity, draft.trigger).find(field => field.field === rule.field);
    const permission = field && referencePermissions[field.type as keyof typeof referencePermissions];
    if (permission) required.push(permission);
  }
  for (const action of draft.actions) {
    if (action.enabled === false) continue;
    if (['create_task', 'assign_owner'].includes(action.type)) {
      const target = WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action));
      if (target.success && target.data.type !== 'record_owner') required.push(target.data.type === 'role' ? 'roles.view' : target.data.type === 'group' ? 'groups.view' : 'users.view');
    }
    if (entity && action.type === 'update_field') {
      const field = getWorkflowUpdateFields(entity).find(field => field.field === action.config.field);
      const permission = field && referencePermissions[field.type as keyof typeof referencePermissions];
      if (permission) required.push(permission);
    }
    // Automated tasks need the same explicit creation and assignment grants.
    if (action.type === 'create_task') required.push('tasks.create', 'tasks.assign');
    if (action.type === 'send_campaign') required.push('campaigns.view', 'campaigns.send');
    if (action.type === 'send_email') required.push('campaigns.send');
    if (action.type === 'send_sms') required.push('campaigns.send', 'contacts.view', 'contacts.edit');
    if (['assign_owner', 'update_field'].includes(action.type)) required.push(entity === 'deal' ? 'deals.edit' : entity === 'account' ? 'accounts.edit' : entity === 'lead' ? 'leads.edit' : 'contacts.edit');
    if (action.type === 'move_deal_stage') required.push('deals.view', 'deals.edit');
    if (action.type === 'update_field' && action.config.field === 'accountId') required.push('accounts.view');
    if (action.type === 'update_field' && ['contactIds', 'leadIds'].includes(String(action.config.field))) required.push(action.config.field === 'leadIds' ? 'leads.view' : 'contacts.view');
  }
  await assertPermissions({userId,tenantId,role:user.role},required);
}
