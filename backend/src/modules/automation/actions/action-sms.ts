import { buildFinalSms, SMS_MAX_LENGTH, smsMessageStats, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { normalizeSmsPhone } from '../../../shared/services/sms.service';
import { renderMessage, resolveMessageValues } from './action-message';

export function validateSmsRecipientMode(mode: unknown, entity: WorkflowEntity) {
  const allowed = entity === 'lead' || entity === 'contact' ? ['record'] : entity === 'account' ? ['primary_contact'] : ['primary_contact', 'primary_lead'];
  if (!allowed.includes(String(mode))) throw new ValidationError('Choose a recipient relationship available for this record.');
}

/** Run Check and dispatch validate the same personalized message. */
export async function prepareWorkflowSmsInput(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  const recipient = await smsRecipient(action, entity, tenantId, context);
  const values = await resolveMessageValues(String(action.config.message ?? ''), tenantId, recipient.entity, { [`${recipient.entity}.id`]: recipient.id });
  const message = renderMessage(String(action.config.message ?? ''), values, false);
  if (!message.trim()) throw new ValidationError('SMS variables left the message empty. Add recipient values or update the message.');
  const final = buildFinalSms({ body: message });
  if (final.length > SMS_MAX_LENGTH) throw new ValidationError(`SMS exceeds the ${SMS_MAX_LENGTH}-character limit after personalization.`);
  return { phone: recipient.phone, recipientId: recipient.id, message, stats: smsMessageStats(final) };
}
export async function smsRecipient(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  validateSmsRecipientMode(action.config.recipient, entity);
  let recipient = { phone: context[`${entity}.phone`], doNotContact: context[`${entity}.doNotContact`], id: context[`${entity}.id`], firstName: context[`${entity}.firstName`], lastName: context[`${entity}.lastName`], email: context[`${entity}.email`], companyName: context[`${entity}.companyName`] };
  if (entity === 'deal') {
    const contact = action.config.recipient === 'primary_contact';
    const id = context[contact ? 'deal.contactId' : 'deal.leadId'];
    if (!id) throw new ValidationError('The deal has no primary recipient for the selected relationship.');
    const record = contact ? await prisma.contact.findFirst({ where: { id: String(id), tenantId, isArchived: false, deletedAt: null } }) : await prisma.lead.findFirst({ where: { id: String(id), tenantId, isArchived: false, deletedAt: null, convertedAt: null } });
    if (!record) throw new ValidationError('The selected primary recipient is unavailable.');
    recipient = { phone: record.phone, doNotContact: 'doNotContact' in record ? record.doNotContact : false, id: record.id, firstName: record.firstName, lastName: record.lastName, email: record.email, companyName: record.companyName };
  } else if (entity === 'account') {
    const contacts = await prisma.contact.findMany({ where: { accountId: String(context['account.id']), tenantId, isArchived: false }, take: 2 });
    if (contacts.length !== 1) throw new ValidationError('Account SMS requires exactly one linked contact. Use a Contact workflow when several contacts are linked.');
    recipient = { phone: contacts[0].phone, doNotContact: contacts[0].doNotContact, id: contacts[0].id, firstName: contacts[0].firstName, lastName: contacts[0].lastName, email: contacts[0].email, companyName: contacts[0].companyName };
  }
  if (recipient.doNotContact === true) throw new ValidationError('The SMS recipient is marked Do not contact.');
  const recipientEntity = entity === 'lead' || action.config.recipient === 'primary_lead' ? 'lead' : 'contact';
  return { phone: normalizeSmsPhone(recipient.phone), id: String(recipient.id), entity: recipientEntity as 'lead' | 'contact', context: Object.fromEntries(Object.entries(recipient).map(([key, value]) => [`${entity}.${key}`, value])) };
}
