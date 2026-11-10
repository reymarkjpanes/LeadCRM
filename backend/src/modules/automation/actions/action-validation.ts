import { validateDealTargets, type WorkflowDealProjection } from './action-deal-targets';
import { resolveTaskDealIds, validateTaskDealSelection } from './action-task-deals';
import { z } from 'zod';
import { workflowLossReasonIssue, workflowMessageEntity, EmailSubjectSchema, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import { validateMessageVariables } from './action-message';
import { fieldUpdatePatch } from './action-fields';
import { prepareWorkflowSmsInput, validateSmsRecipientMode } from './action-sms';
import { isSmsConfigured } from '../../../shared/services/sms.service';
import { validateAssignment } from '../assignment/workflow-assignment.service';
import prisma from '../../../config/database.config';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import { getAvailableActions } from './actions.service';
import * as repo from './actions.repository';
import { normalizeWorkflowEmailAction, prepareWorkflowEmailInput, validateWorkflowEmailContent } from './action-email';
import { retiredAccountWorkflowReferences, ACCOUNT_RETIREMENT_REASON } from '@leadcrm/shared';

export function actionEntity(context: Record<string, unknown>): WorkflowEntity {
  const matches = (['lead', 'contact', 'deal', 'account'] as const).filter(entity => typeof context[`${entity}.id`] === 'string');
  if (matches.length !== 1) throw new ValidationError('Choose one triggering CRM record.');
  return matches[0];
}
export async function validateAction(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context?: Record<string, unknown>, incomplete = false, projection?: WorkflowDealProjection): Promise<void> {
  action = normalizeWorkflowEmailAction(action);
  if (retiredAccountWorkflowReferences({ trigger: `${entity}.updated`, actions: [action] }).length) {
    if (incomplete) return;
    throw new ValidationError(ACCOUNT_RETIREMENT_REASON);
  }
  if (['send_campaign', 'create_notification'].includes(action.type)) {
    if (incomplete || action.enabled === false) return;
    throw new ValidationError('This action is retired. Disable or remove it before activating.');
  }
  const definition = getAvailableActions().find(entry => entry.type === action.type);
  if (!definition) {
    if (incomplete || action.enabled === false) return;
    throw new ValidationError(`Action ${action.type} is not supported for ${entity}.`);
  }
  const supported = definition.entities.includes(entity);
  if (!supported && !incomplete && action.enabled !== false) throw new ValidationError(`Action ${action.type} is not supported for ${entity}.`);
  if (action.type === 'update_field') {
    await fieldUpdatePatch(action, entity, tenantId, incomplete || action.enabled === false);
    return;
  }
  for (const key of Object.keys(action.config)) {
    if (!definition.configSchema[key]) throw new ValidationError(`Remove unsupported action setting: ${key}.`);
  }
  if (action.type === 'move_deal_stage') {
    const reasonIssue = workflowLossReasonIssue(action.config, incomplete || action.enabled === false);
    if (reasonIssue) throw new ValidationError(reasonIssue);
  }
  for (const [key, field] of Object.entries(definition.configSchema)) {
    const value = action.config[key];
    if (action.type === 'move_deal_stage' && ['includeLossReason', 'lostReason'].includes(key)) continue;
    if (action.type === 'send_email' && ['subject', 'body'].includes(key) && typeof value === 'string' && !value.trim()) continue;
    if (field.type === 'assignment' || (action.type === 'create_task' && key === 'assignedUserId') || (action.type === 'assign_owner' && key === 'userId')) continue;
    if (!incomplete && action.enabled !== false && field.required && (typeof value !== 'string' || !value.trim())) throw new ValidationError(`${field.label} is required.`);
    if (value === undefined || value === '') continue;
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 365) throw new ValidationError(`${field.label} must be a whole number from 0 to 365.`);
    } else if (typeof value !== 'string' || value.length > 10000) throw new ValidationError(`${field.label} must be text.`);
    if (typeof value === 'string' && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new ValidationError(`${field.label} contains control characters.`);
    if (key === 'title' && (String(value).length > 255 || /[\r\n\t]/.test(String(value)))) throw new ValidationError('Title must be at most 255 characters without control characters.');
    if (['user', 'stage', 'template', 'campaign', 'products'].includes(field.type) && !z.string().uuid().safeParse(value).success) throw new ValidationError(`Choose a valid ${field.label}.`);
    if (key === 'subject' && !EmailSubjectSchema.safeParse(value).success) throw new ValidationError('Email subject must not contain line breaks or control characters.');
    if (['title', 'description', 'subject', 'body', 'message'].includes(key)) await validateMessageVariables(String(value), workflowMessageEntity(entity, ['send_sms', 'send_email'].includes(action.type) ? action.config.recipient : undefined), tenantId);
    if (field.options && !field.options.includes(String(value))) throw new ValidationError(`Choose a supported ${field.label.toLowerCase()}.`);
    if (field.type === 'user' && !await repo.findUser(String(value), tenantId)) throw new NotFoundError('Active workspace user');
    if (field.type === 'products' && !await prisma.productInterest.findFirst({ where: { tenantId, id: String(value), active: true } })) throw new NotFoundError('Product Interest');
    if (field.type === 'stage' && !await repo.findStage(String(value), tenantId)) throw new NotFoundError('Stage');
    if (field.type === 'template' && !await repo.findTemplate(String(value), tenantId)) throw new NotFoundError('Email template');
    if (field.type === 'campaign' && !await repo.findCampaign(String(value), tenantId)) throw new NotFoundError('Campaign');
  }
  if (['create_task', 'assign_owner'].includes(action.type)) await validateAssignment(action, entity, tenantId, context, incomplete || action.enabled === false);
  if (action.type === 'create_task') {
    await validateTaskDealSelection(action, entity, tenantId);
    if (context && action.enabled !== false) await resolveTaskDealIds(action, entity, tenantId, context);
  }
  // Repairable legacy drafts still validate settings and tenant-scoped references.
  if (!supported) return;
  // Disabled steps retain safe configuration and scoped references, but need no delivery readiness.
  if (action.enabled === false) return;
  if (incomplete && Object.entries(definition.configSchema).some(([key, field]) => field.required && !action.config[key])) return;
  if (incomplete && action.type === 'send_email' && !action.config.templateId && (!action.config.subject || !action.config.body)) return;
  if (action.type === 'move_deal_stage') {
    const stage = await repo.findStage(String(action.config.stageId), tenantId);
    if (!stage) throw new NotFoundError('Stage');
    if (action.config.currentStageId && (await repo.findStage(String(action.config.currentStageId), tenantId))?.pipelineId !== stage.pipelineId) throw new ValidationError('Current and target stages must belong to the same pipeline.');
    if (entity === 'deal' && (action.config.targetMode || action.config.productInterestId || action.config.currentStageId)) throw new ValidationError('Related Deal filters require a Lead or Contact trigger.');
    if (context) {
      await validateDealTargets(action, entity, tenantId, context, projection);
    }
  }
  if (action.type === 'send_email') await validateEmail(action, entity, tenantId, context);
  if (action.type === 'send_sms') {
    validateSmsRecipientMode(action.config.recipient, entity);
    if (String(action.config.message ?? '').length > 1600) throw new ValidationError('SMS message must be at most 1600 characters.');
    if (!incomplete && !isSmsConfigured()) throw new ValidationError('Configure the SMS sender and API key before activating SMS workflows.');
    if (context) await prepareWorkflowSmsInput(action, entity, tenantId, context);
  }
}
export async function validateEmail(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context?: Record<string, unknown>): Promise<void> {
  if (context) await prepareWorkflowEmailInput(action, entity, tenantId, context);
  else await validateWorkflowEmailContent(action, entity, tenantId);
}
