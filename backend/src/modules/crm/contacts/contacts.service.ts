import * as repo from './contacts.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { CreateContactSchema, UpdateContactSchema, ConvertContactSchema, CreateContactDto, UpdateContactDto, ConvertContactDto } from './contacts.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireLeadStatusChanged, fireContactCreated, fireContactStatusChanged, fireContactUpdated, fireDealUpdated } from '../../automation/triggers/triggers.service';
import { salesTransaction } from '../leads/lead-automation.service';
import { convertClosedLead } from '../leads/lead-conversion.service';
import { assertClosedStatus, changeCustomerStatus } from '../engagement.service';
import { normalizeCrmStatus } from '@leadcrm/shared';
import { fireLeadUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges } from '../record-updates';

export async function getContacts(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllContacts(tenantId, query);
  return { ...paginate(result.data, result.total, { page: result.page, limit: result.limit }), facets: result.facets };
}

export async function getContactById(id: string, tenantId: string) {
  const contact = await repo.findContactById(id, tenantId);
  if (!contact) throw new NotFoundError('Lead');
  return contact;
}

export async function createContact(tenantId: string, userId: string, dto: CreateContactDto) {
  dto = CreateContactSchema.parse(dto);
  const contact = await repo.createContact(tenantId, dto, userId);

  // The Lead transaction captures its assignment in NotificationEvent.

  return contact;
}

export async function updateContact(
  id: string, tenantId: string, userId: string, dto: UpdateContactDto,
) {
  dto = UpdateContactSchema.parse(dto);
  return repo.updateContact(id, tenantId, dto, userId, undefined, async (before, contact, changes) => {
    if (changes.changedFields.length) await fireLeadUpdated({ tenantId, actorId: userId, record: contact, changedFields: changes.changedFields, changes });
    if (contact.status !== before.status) await fireLeadStatusChanged({ tenantId, actorId: userId, lead: contact, prevStatus: before.status });
  });
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  const result = await repo.archiveContact(id, tenantId, userId);
  if (!result.count) throw new NotFoundError('Active Lead');
  await writeAuditLog({ tenantId, userId, action: 'lead.archived',
    entityType: 'Lead', entityId: id, after: { isArchived: true } });
}

export async function restoreContact(id: string, tenantId: string, userId: string) {
  const result = await repo.restoreContact(id, tenantId);
  if (!result.count) throw new NotFoundError('Archived Lead');
  await writeAuditLog({ tenantId, userId, action: 'lead.restored',
    entityType: 'Lead', entityId: id, after: { isArchived: false } });
}

/** The legacy endpoint uses the same successful-sales conversion transaction. */
export async function convertContact(id: string, tenantId: string, userId: string, dto: ConvertContactDto) {
  dto = ConvertContactSchema.parse(dto);
  const committed = await salesTransaction(async tx => {
    const lead = await tx.lead.findFirst({ where: { tenantId, id, isArchived: false, deletedAt: null } });
    if (!lead) throw new NotFoundError('Lead');
    if (dto.createDeal) throw new ValidationError('Complete an existing Deal before converting this Lead.');
    if (dto.dealId && !await tx.deal.findFirst({ where: { tenantId, id: dto.dealId,
      leadDeals: { some: { tenantId, leadId: id } } } })) throw new ValidationError('Choose a Deal already associated with this Lead.');
    await assertClosedStatus(tx, tenantId, { leadId: id });
    // Capture the records this conversion may link before any transaction writes.
    const previousContacts = await tx.contact.findMany({ where: { tenantId, OR: [
      { id: dto.contactId ?? lead.contactId ?? '' },
      ...(lead.email?.trim() ? [{ email: { contains: lead.email.trim(), mode: 'insensitive' as const } }] : []),
    ] } });
    const previousDeals = await tx.deal.findMany({ where: { tenantId, leadDeals: { some: { tenantId, leadId: id } } } });
    // Never replace the identity of a previously converted customer on a retry.
    if (!lead.convertedAt) await tx.lead.update({ where: { tenantId, id }, data: {
      ...(dto.contactId ? { contactId: dto.contactId } : {}), ...(dto.accountId ? { accountId: dto.accountId } : {}),
      ...(!lead.companyName?.trim() && dto.accountName?.trim() ? { companyName: dto.accountName.trim() } : {}),
    } });
    if (!lead.convertedAt) await changeCustomerStatus(tx, tenantId, userId, { leadId: id }, 'Closed', 'Staff confirmed completed sales conversion.', new Date());
    const converted = await convertClosedLead(tx, tenantId, id, userId);
    const account = converted.accountId ? await tx.account.findFirst({ where: { tenantId, id: converted.accountId } }) : null;
    const deal = dto.dealId ? await tx.deal.findFirst({ where: { tenantId, id: dto.dealId } }) : null;
    const updatedDeals = await tx.deal.findMany({ where: { tenantId, id: { in: previousDeals.map(record => record.id) } } });
    return { lead: converted.lead, contact: converted.contact, account, deal, previousLead: lead,
      previousContact: previousContacts.find(record => record.id === converted.contact.id), previousDeals, updatedDeals };
  });
  // Workflow side effects run only after a successful commit, never on a retry/rollback.
  const { lead, contact, account, deal, previousLead, previousContact, previousDeals, updatedDeals } = committed;
  const leadChanges = recordChanges(previousLead, lead);
  if (leadChanges.changedFields.length) await fireLeadUpdated({ tenantId, actorId: userId, record: lead, changedFields: leadChanges.changedFields, changes: leadChanges });
  await fireLeadStatusChanged({ tenantId, actorId: userId, lead, prevStatus: previousLead.status });
  if (!previousContact) await fireContactCreated({ tenantId, actorId: userId, contact });
  else {
    const changes = recordChanges(previousContact, contact);
    if (changes.changedFields.length) await fireContactUpdated({ tenantId, actorId: userId, record: contact, changedFields: changes.changedFields, changes });
    await fireContactStatusChanged({ tenantId, actorId: userId, contact, prevStatus: previousContact.status });
  }
  for (const record of updatedDeals) {
    const previous = previousDeals.find(before => before.id === record.id)!;
    const changes = recordChanges(previous, record);
    if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId: userId, record, changedFields: changes.changedFields, changes });
  }
  return { lead, contact: { ...contact, status: normalizeCrmStatus(contact.status) }, account, deal };
}
