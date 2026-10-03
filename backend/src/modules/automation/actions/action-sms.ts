import type { WorkflowAction, WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { normalizeSmsPhone } from '../../../shared/services/sms.service';

export function validateSmsRecipientMode(mode: unknown, entity: WorkflowEntity) {
  const allowed = entity === 'lead' || entity === 'contact' ? ['record'] : entity === 'account' ? ['primary_contact'] : ['primary_contact', 'primary_lead'];
  if (!allowed.includes(String(mode))) throw new ValidationError('Choose a recipient relationship available for this record.');
}
export async function smsRecipient(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  validateSmsRecipientMode(action.config.recipient, entity);
  let recipient = { phone: context[`${entity}.phone`], doNotContact: context[`${entity}.doNotContact`], id: context[`${entity}.id`], firstName: context[`${entity}.firstName`], lastName: context[`${entity}.lastName`], email: context[`${entity}.email`], company: context[`${entity}.company`] ?? context[`${entity}.companyName`] };
  if (entity === 'deal') {
    const contact = action.config.recipient === 'primary_contact';
    const id = context[contact ? 'deal.contactId' : 'deal.leadId'];
    if (!id) throw new ValidationError('The deal has no primary recipient for the selected relationship.');
    const record = contact ? await prisma.contact.findFirst({ where: { id: String(id), tenantId, isArchived: false } }) : await prisma.lead.findFirst({ where: { id: String(id), tenantId, isArchived: false } });
    if (!record) throw new ValidationError('The selected primary recipient is unavailable.');
    recipient = { phone: record.phone, doNotContact: 'doNotContact' in record ? record.doNotContact : false, id: record.id, firstName: record.firstName, lastName: record.lastName, email: record.email, company: 'company' in record ? record.company : record.companyName };
  } else if (entity === 'account') {
    const contacts = await prisma.contact.findMany({ where: { accountId: String(context['account.id']), tenantId, isArchived: false }, take: 2 });
    if (contacts.length !== 1) throw new ValidationError('Account SMS requires exactly one linked contact. Use a Contact workflow when several contacts are linked.');
    recipient = { phone: contacts[0].phone, doNotContact: contacts[0].doNotContact, id: contacts[0].id, firstName: contacts[0].firstName, lastName: contacts[0].lastName, email: contacts[0].email, company: contacts[0].company };
  }
  if (recipient.doNotContact === true) throw new ValidationError('The SMS recipient is marked Do not contact.');
  return { phone: normalizeSmsPhone(recipient.phone), id: String(recipient.id), context: Object.fromEntries(Object.entries(recipient).map(([key, value]) => [`${entity}.${key}`, value])) };
}
