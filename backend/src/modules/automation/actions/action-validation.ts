import { z } from 'zod';
import { EmailSubjectSchema, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import { fieldUpdatePatch } from './action-fields';
import { smsRecipient, validateSmsRecipientMode } from './action-sms';
import { isSmsConfigured } from '../../../shared/services/sms.service';
import { validateSalesOwner } from '../../crm/leads/lead-automation.service';
import prisma from '../../../config/database.config';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import { getAvailableActions } from './actions.service';
import * as repo from './actions.repository';
import { validateDealStageMove } from '../../crm/deals/deals.service';
import { sanitizeCampaignHtml } from '../../marketing/campaigns/campaign-content';

export function actionEntity(context: Record<string, unknown>): WorkflowEntity {
  const matches = (['lead', 'contact', 'deal', 'account'] as const).filter(entity => typeof context[`${entity}.id`] === 'string');
  if (matches.length !== 1) throw new ValidationError('Choose one triggering CRM record.');
  return matches[0];
}
export function actionUser(config: Record<string, unknown>, key: string, entity: WorkflowEntity, context?: Record<string, unknown>): string {
  return String(config[key] || context?.[`${entity}.assignedUserId`] || '');
}
export async function validateAction(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context?: Record<string, unknown>, incomplete = false): Promise<void> {
  if (['send_campaign', 'create_notification'].includes(action.type)) {
    if (incomplete || action.enabled === false) return;
    throw new ValidationError('This action is retired. Disable or remove it before activating.');
  }
  const definition = getAvailableActions().find(entry => entry.type === action.type);
  if (!definition || !definition.entities.includes(entity)) throw new ValidationError(`Action ${action.type} is not supported for ${entity}.`);
  if (action.type === 'update_field') {
    await fieldUpdatePatch(action, entity, tenantId, incomplete || action.enabled === false);
    return;
  }
  for (const key of Object.keys(action.config)) {
    if (!definition.configSchema[key]) throw new ValidationError(`Remove unsupported action setting: ${key}.`);
  }
  for (const [key, field] of Object.entries(definition.configSchema)) {
    const value = action.config[key];
    if (!incomplete && action.enabled !== false && field.required && (typeof value !== 'string' || !value.trim())) throw new ValidationError(`${field.label} is required.`);
    if (value === undefined || value === '') continue;
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 365) throw new ValidationError(`${field.label} must be a whole number from 0 to 365.`);
    } else if (typeof value !== 'string' || value.length > 10000) throw new ValidationError(`${field.label} must be text.`);
    if (typeof value === 'string' && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new ValidationError(`${field.label} contains control characters.`);
    if (key === 'title' && (String(value).length > 255 || /[\r\n\t]/.test(String(value)))) throw new ValidationError('Title must be at most 255 characters without control characters.');
    if (['user', 'stage', 'template', 'campaign'].includes(field.type) && !z.string().uuid().safeParse(value).success) throw new ValidationError(`Choose a valid ${field.label}.`);
    if (key === 'subject' && !EmailSubjectSchema.safeParse(value).success) throw new ValidationError('Email subject must not contain line breaks or control characters.');
    if (['title', 'description', 'body', 'message'].includes(key)) validateVariables(String(value));
    if (field.options && !field.options.includes(String(value))) throw new ValidationError(`Choose a supported ${field.label.toLowerCase()}.`);
    if (field.type === 'user' && !await repo.findUser(String(value), tenantId)) throw new NotFoundError('Active workspace user');
    if (field.type === 'stage' && !await repo.findStage(String(value), tenantId)) throw new NotFoundError('Stage');
    if (field.type === 'template' && !await repo.findTemplate(String(value), tenantId)) throw new NotFoundError('Email template');
    if (field.type === 'campaign' && !await repo.findCampaign(String(value), tenantId)) throw new NotFoundError('Campaign');
  }
  // Disabled steps retain safe configuration and scoped references, but need no delivery readiness.
  if (action.enabled === false) return;
  if (incomplete && Object.entries(definition.configSchema).some(([key, field]) => field.required && !action.config[key])) return;
  if (incomplete && action.type === 'send_email' && !action.config.templateId && (!action.config.subject || !action.config.body)) return;
  if (context && ['create_task', 'create_notification'].includes(action.type)) {
    const key = action.type === 'create_task' ? 'assignedUserId' : 'userId';
    const userId = actionUser(action.config, key, entity, context);
    if (!userId) throw new ValidationError('Choose an agent or assign an agent to the triggering record.');
    if (!await repo.findUser(userId, tenantId)) throw new NotFoundError('Active workspace user');
  }
  if (action.type === 'move_deal_stage') {
    const stage = await repo.findStage(String(action.config.stageId), tenantId);
    if (!stage) throw new NotFoundError('Stage');
    if (stage.isLost && !String(action.config.lostReason ?? '').trim()) throw new ValidationError('Enter a reason for closing the deal as lost.');
    if (context) {
      await validateDealStageMove(String(context['deal.id']), tenantId, { stageId: stage.id, lostReason: String(action.config.lostReason ?? '') });
    }
  }
  if (action.type === 'send_email') await validateEmail(action, entity, tenantId, context);
  if (action.type === 'assign_owner') await validateSalesOwner(prisma, tenantId, String(action.config.userId));
  if (action.type === 'send_sms') {
    validateSmsRecipientMode(action.config.recipient, entity);
    if (String(action.config.message ?? '').length > 1600) throw new ValidationError('SMS message must be at most 1600 characters.');
    if (!incomplete && !isSmsConfigured()) throw new ValidationError('Configure the SMS sender and API key before activating SMS workflows.');
    if (context) await smsRecipient(action, entity, tenantId, context);
  }
}
export async function validateEmail(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context?: Record<string, unknown>): Promise<void> {
  const template = action.config.templateId ? await repo.findTemplate(String(action.config.templateId), tenantId) : null;
  if (action.config.templateId && !template) throw new NotFoundError('Email template');
  const subject = String(action.config.subject || template?.subject || '');
  const content = String(action.config.body || template?.content || '');
  if (!subject.trim() || !sanitizeCampaignHtml(content).trim()) throw new ValidationError('Choose a complete template or enter an email subject and message.');
  if (!EmailSubjectSchema.safeParse(subject).success) throw new ValidationError('Email subject must be at most 200 characters without line breaks or control characters.');
  validateVariables(`${subject} ${content}`);
  if (!await repo.findSender(String(action.config.senderUserId), tenantId)) throw new ValidationError('Connect the selected sender to Gmail before activating.');
  if (context) {
    if (!z.string().email().safeParse(context[`${entity}.email`]).success) throw new ValidationError('No valid email address found for the triggering record.');
    if (context[`${entity}.doNotContact`] === true) throw new ValidationError('This Contact is marked Do not contact.');
  }
}


function validateVariables(value: string) {
  for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!['first_name', 'last_name', 'email', 'company'].includes(match[1])) throw new ValidationError('Use only the supported message variables.');
  }
}
