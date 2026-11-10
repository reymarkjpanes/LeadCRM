import { randomUUID } from 'node:crypto';
import * as repo from './contacts.repository';
import { mayReadContactAccount, presentContactAccount } from '../contacts-v2/contact-account-access';
import prisma from '../../../config/database.config';
import { salesContext } from '../leads/sales-context';

async function presentLead<T extends { account?: unknown; accountId?: string | null; companyName?: string | null; companyFromAccount?: boolean }>(tenantId: string, lead: T) {
  return presentContactAccount(lead, await mayReadContactAccount(salesContext.getStore() ?? prisma, tenantId, lead.accountId));
}
import { assertCrmRecordMutation } from '../access/crm-record-access.service';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { CreateContactSchema, UpdateContactSchema, ConvertContactSchema, CreateContactDto, UpdateContactDto, ConvertContactDto } from './contacts.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireLeadStatusChanged, fireLeadUpdated } from '../../automation/triggers/triggers.service';
import { salesTransaction } from '../leads/lead-automation.service';
import { convertLead } from '../leads/lead-conversion.service';
import { normalizeCrmStatus } from '@leadcrm/shared';

export async function getContacts(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllContacts(tenantId, query);
  const canReadAccount = await mayReadContactAccount(salesContext.getStore() ?? prisma, tenantId);
  const data = result.data.map(lead => presentContactAccount(lead, canReadAccount));
  return { ...paginate(data, result.total, { page: result.page, limit: result.limit }), facets: result.facets };
}

export async function getContactById(id: string, tenantId: string) {
  const contact = await repo.findContactById(id, tenantId);
  if (!contact) throw new NotFoundError('Lead');
  return presentLead(tenantId, contact);
}

export async function createContact(tenantId: string, userId: string, dto: CreateContactDto) {
  dto = CreateContactSchema.parse(dto);
  const created = await repo.createContact(tenantId, dto, userId);
  const contact = (await repo.findContactById(created.id, tenantId))!;

  // The Lead transaction captures its assignment in NotificationEvent.

  return presentLead(tenantId, contact);
}

export async function updateContact(
  id: string, tenantId: string, userId: string, dto: UpdateContactDto,
) {
  dto = UpdateContactSchema.parse(dto);
  const updated = await repo.updateContact(id, tenantId, dto, userId, undefined, async (before, contact, changes) => {
    const eventId = randomUUID();
    if (changes.changedFields.length) await fireLeadUpdated({ tenantId, actorId: userId, eventId, record: contact, changedFields: changes.changedFields, changes });
    if (contact.status !== before.status) await fireLeadStatusChanged({ tenantId, actorId: userId, eventId, lead: contact, prevStatus: before.status });
  });
  return presentLead(tenantId, updated);
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

/** Basic conversion retains sales status and uses the existing atomic relationship writer. */
export async function convertContact(id: string, tenantId: string, userId: string, dto: ConvertContactDto) {
  dto = ConvertContactSchema.parse(dto);
  return salesTransaction(async tx => {
    await assertCrmRecordMutation(tx, 'leads', id);
    const lead = await tx.lead.findFirst({ where: { tenantId, id, isArchived: false, deletedAt: null } });
    if (!lead) throw new NotFoundError('Lead');
    if (dto.createDeal) throw new ValidationError('Create Deals separately from Lead conversion.');
    if (dto.dealId && !await tx.deal.findFirst({ where: { tenantId, id: dto.dealId,
      leadDeals: { some: { tenantId, leadId: id } } } })) throw new ValidationError('Choose a Deal already associated with this Lead.');
    // Never replace the identity of a previously converted customer on a retry.
    if (!lead.convertedAt) {
      if (dto.accountId && !await tx.account.findFirst({ where: { tenantId, id: dto.accountId, isArchived: false, deletedAt: null } })) throw new NotFoundError('Active Account');
      if (dto.contactId && !await tx.contact.findFirst({ where: { tenantId, id: dto.contactId, isArchived: false, deletedAt: null } })) throw new NotFoundError('Active Contact');
      if ((dto.contactId && dto.contactId !== lead.contactId) || (dto.accountId && dto.accountId !== lead.accountId)) {
        await tx.lead.update({ where: { tenantId, id }, data: {
          ...(dto.contactId ? { contactId: dto.contactId } : {}), ...(dto.accountId ? { accountId: dto.accountId } : {}),
        } });
      }
    }
    const converted = await convertLead(tx, tenantId, id, userId, { previousLead: lead, accountName: dto.accountName,
      newAccount: dto.newAccount, skipAccountCreation: dto.skipAccountCreation });
    const account = converted.accountId ? await tx.account.findFirst({ where: { tenantId, id: converted.accountId } }) : null;
    const deal = dto.dealId ? await tx.deal.findFirst({ where: { tenantId, id: dto.dealId } }) : null;
    const canReadAccount = await mayReadContactAccount(tx, tenantId, converted.lead.accountId);
    return { lead: presentContactAccount(converted.lead, canReadAccount), contact: presentContactAccount({ ...converted.contact, status: normalizeCrmStatus(converted.contact.status) }, canReadAccount), account: canReadAccount ? account : null, deal };
  });
}
