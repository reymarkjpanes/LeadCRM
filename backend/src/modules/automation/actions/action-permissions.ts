import type { WorkflowDraft } from '@leadcrm/shared';
import { findUser } from './actions.repository';
import { assertPermissions } from '../../../core/permissions/permission.service';
import type { PermissionKey } from '../../../shared/constants/permissions';
import { AppError } from '../../../shared/errors/app-error';
import { findTrigger } from '../triggers/trigger-catalog';

/** Reuse the same active assignments and flag mapping as the HTTP RBAC guard. */
export async function assertWorkflowPermissions(draft: WorkflowDraft, tenantId: string, userId: string) {
  const user = await findUser(userId, tenantId);
  if (!user || user.role.trim().toLowerCase() === 'guest') throw new AppError('Workflow author is unavailable.', 403);
  const entity = findTrigger(draft.trigger)?.entity;
  const required: PermissionKey[] = ['workflows.activate', entity === 'deal' ? 'deals.view' : entity === 'account' ? 'accounts.view' : entity === 'lead' ? 'leads.view' : 'contacts.view'];
  for (const action of draft.actions) {
    if (action.enabled === false) continue;
    // Automated tasks need the same explicit creation and assignment grants.
    if (action.type === 'create_task') required.push('tasks.create', 'tasks.assign');
    if (action.type === 'send_campaign') required.push('campaigns.view', 'campaigns.send');
    if (action.type === 'send_email') required.push('campaigns.send');
    if (action.type === 'send_sms') required.push('campaigns.send', 'contacts.view', 'contacts.edit');
    if (['assign_owner', 'update_field', 'move_deal_stage'].includes(action.type)) required.push(entity === 'deal' ? 'deals.edit' : entity === 'account' ? 'accounts.edit' : entity === 'lead' ? 'leads.edit' : 'contacts.edit');
    if (action.type === 'update_field' && action.config.field === 'accountId') required.push('accounts.view');
    if (action.type === 'update_field' && ['contactIds', 'leadIds'].includes(String(action.config.field))) required.push(action.config.field === 'leadIds' ? 'leads.view' : 'contacts.view');
  }
  await assertPermissions({userId,tenantId,role:user.role},required);
}
