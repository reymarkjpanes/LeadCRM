import { buildFinalSms, SMS_MAX_LENGTH, smsMessageStats, workflowMessageEntity, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { normalizeSmsPhone } from '../../../shared/services/sms.service';
import { renderMessage, resolveMessageValues } from './action-message';

export function validateSmsRecipientMode(mode: unknown, entity: WorkflowEntity) {
  const allowed = entity === 'deal' ? ['primary_contact', 'primary_lead'] : entity === 'account' ? [] : ['record'];
  if (!allowed.includes(String(mode))) throw new ValidationError('Choose a recipient relationship available for this record.');
}

/** Run Check and dispatch validate the same personalized message. */
export async function prepareWorkflowSmsInput(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  const recipient = await smsRecipient(action, entity, tenantId, context);
  const values = await resolveMessageValues(String(action.config.message ?? ''), tenantId, recipient.entity, recipient.context);
  const message = renderMessage(String(action.config.message ?? ''), values, false);
  if (!message.trim()) throw new ValidationError('SMS variables left the message empty. Add recipient values or update the message.');
  const final = buildFinalSms({ body: message });
  if (final.length > SMS_MAX_LENGTH) throw new ValidationError(`SMS exceeds the ${SMS_MAX_LENGTH}-character limit after personalization.`);
  return { phone: recipient.phone, recipientId: recipient.id, recipientEntity: recipient.entity, message, stats: smsMessageStats(final) };
}
async function smsRecipient(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  validateSmsRecipientMode(action.config.recipient, entity);
  const recipientEntity = workflowMessageEntity(entity, action.config.recipient);
  if (recipientEntity !== 'lead' && recipientEntity !== 'contact') throw new ValidationError('Choose a Lead or Contact recipient.');
  const id = context[entity === 'deal' ? `deal.${recipientEntity}Id` : `${recipientEntity}.id`];
  if (typeof id !== 'string' || !id) {
    throw new ValidationError(entity === 'deal' ? 'The Deal has no primary recipient for the selected relationship.' : 'The SMS recipient is unavailable.');
  }
  const where = { tenantId, id, isArchived: false, deletedAt: null };
  const recipient = recipientEntity === 'lead' ? await prisma.lead.findFirst({ where: { ...where, convertedAt: null }, select: { phone: true } })
    : await prisma.contact.findFirst({ where, select: { phone: true, doNotContact: true } });
  if (!recipient) throw new ValidationError('The SMS recipient is unavailable.');
  if ('doNotContact' in recipient && recipient.doNotContact) throw new ValidationError('The SMS recipient is marked Do not contact.');
  const phone = entity === 'deal' ? recipient.phone : context[`${recipientEntity}.phone`];
  return { phone: normalizeSmsPhone(phone), id, entity: recipientEntity, context: entity === 'deal' ? { [`${recipientEntity}.id`]: id } : context };
}
