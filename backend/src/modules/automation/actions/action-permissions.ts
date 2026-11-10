import { campaignFieldsForSource, campaignVariableKeys, getWorkflowConditionFields, getWorkflowUpdateFields, workflowAssignmentTarget, WorkflowAssignmentTargetSchema, workflowMessageEntity, WORKFLOW_MODULES, type WorkflowDraft } from '@leadcrm/shared';
import { findUser } from './actions.repository';
import { assertPermissions } from '../../../core/permissions/permission.service';
import type { PermissionKey } from '../../../shared/constants/permissions';
import { AppError } from '../../../shared/errors/app-error';
import { findTrigger } from '../triggers/trigger-catalog';
import { findTemplate } from './actions.repository';
import { campaignVariableFields } from '../../marketing/campaigns/audiences.service';
import { workflowEmailContent } from './action-email-content';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';

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
export async function assertWorkflowPermissions(draft: WorkflowDraft, tenantId: string, userId: string, capability: 'workflows.activate' | 'workflows.pause' | 'workflows.execute' = 'workflows.activate', db: Prisma.TransactionClient = prisma) {
  const user = await findUser(userId, tenantId, db);
  if (!user || user.role.trim().toLowerCase() === 'guest') throw new AppError('Workflow author is unavailable.', 403);
  const entity = findTrigger(draft.trigger)?.entity;
  const required: PermissionKey[] = [capability, entity === 'deal' ? 'deals.view' : entity === 'account' ? 'accounts.view' : entity === 'lead' ? 'leads.view' : 'contacts.view'];
  const referencePermissions = { user: 'users.view', products: 'products.view', account: 'accounts.view', contacts: 'contacts.view', leads: 'leads.view', stage: 'deals.view', pipeline: 'deals.view' } as const;
  if (entity) for (const rule of draft.conditions?.conditions ?? []) {
    const field = getWorkflowConditionFields(entity, draft.trigger).find(field => field.field === rule.field);
    const permission = field && referencePermissions[field.type as keyof typeof referencePermissions];
    if (permission) required.push(permission);
  }
  for (const action of draft.actions) {
    if (action.enabled === false) continue;
    if (entity && ['create_task', 'send_email', 'send_sms'].includes(action.type)) {
      const template = action.type === 'send_email' && action.config.templateId ? await findTemplate(String(action.config.templateId), tenantId, db) : null;
      const emailContent = action.type === 'send_email' ? workflowEmailContent(action.config, template) : undefined;
      const content = emailContent ? `${emailContent.subject} ${emailContent.body}`
        : action.type === 'send_sms' ? String(action.config.message ?? '') : `${action.config.title ?? ''} ${action.config.description ?? ''}`;
      const keys = campaignVariableKeys(content);
      if (keys.length) {
        const messageEntity = workflowMessageEntity(entity, ['send_sms', 'send_email'].includes(action.type) ? action.config.recipient : undefined);
        const catalog = await campaignVariableFields(tenantId);
        const fields = messageEntity === 'lead' || messageEntity === 'contact' ? campaignFieldsForSource(catalog, messageEntity === 'lead' ? 'LEADS' : 'CONTACTS') : catalog.filter(field => field.module === WORKFLOW_MODULES[messageEntity]);
        for (const field of fields.filter(field => keys.includes(field.technicalKey) || !!field.canonicalTechnicalKey && keys.includes(field.canonicalTechnicalKey))) {
          required.push(`${field.module}.view` as PermissionKey);
          if (field.reference) required.push(field.reference === 'user' ? 'users.view' : field.reference === 'account' ? 'accounts.view' : 'deals.view');
          if (field.type === 'products') required.push('products.view');
        }
        if (keys.includes('company_name')) required.push('accounts.view');
      }
    }
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
    if (action.type === 'create_task') required.push('tasks.create', 'tasks.assign', 'deals.view');
    if (action.type === 'send_campaign') required.push('campaigns.view', 'campaigns.send');
    if (action.type === 'send_email') required.push('campaigns.send');
    if (action.type === 'send_email' && entity === 'deal') required.push(action.config.recipient === 'primary_lead' ? 'leads.view' : 'contacts.view');
    if (action.type === 'send_sms' && entity) {
      const recipientModule = workflowMessageEntity(entity, action.config.recipient) === 'lead' ? 'leads' : 'contacts';
      required.push('campaigns.send', `${recipientModule}.view`, `${recipientModule}.edit`);
    }
    if (['assign_owner', 'update_field'].includes(action.type)) required.push(entity === 'deal' ? 'deals.edit' : entity === 'account' ? 'accounts.edit' : entity === 'lead' ? 'leads.edit' : 'contacts.edit');
    if (action.type === 'move_deal_stage') required.push('deals.view', 'deals.edit');
    if (action.type === 'update_field' && action.config.field === 'accountId') required.push('accounts.view');
    if (action.type === 'update_field' && ['contactIds', 'leadIds'].includes(String(action.config.field))) required.push(action.config.field === 'leadIds' ? 'leads.view' : 'contacts.view');
  }
  await assertPermissions({userId,tenantId,role:user.role},required,db);
}
