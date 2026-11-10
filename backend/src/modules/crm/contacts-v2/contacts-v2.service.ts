import { randomUUID } from 'node:crypto';
import { salesContext } from '../leads/sales-context';
import { withCustomerStatusPolicy } from '../customer-classification.service';
import { CreateClientContactSchema, UpdateClientContactSchema } from './contacts-v2.dto';
import { normalizeCrmStatus } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import * as repo from './contacts-v2.repository';
import { NotFoundError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import { fireContactStatusChanged, fireContactUpdated } from '../../automation/triggers/triggers.service';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { recordChanges, customFieldChangeTracker } from '../record-updates';
import { salesTransaction } from '../leads/lead-automation.service';
import { assertContactAccountSelection, mayReadContactAccount, presentContactAccount } from './contact-account-access';

async function presentContact<T extends { id: string; status: string; account: unknown; accountId?: string | null; companyFromAccount?: boolean; companyName?: string | null }>(tenantId: string, contact: T) {
  const [presented] = await withCustomerStatusPolicy(salesContext.getStore() ?? prisma, tenantId, 'contact', [contact]);
  return presentContactAccount({ ...presented, status: normalizeCrmStatus(contact.status) }, await mayReadContactAccount(salesContext.getStore() ?? prisma, tenantId, contact.accountId));
}

export async function getContacts(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllContacts(tenantId, query);
  const records = await withCustomerStatusPolicy(salesContext.getStore() ?? prisma, tenantId, 'contact', result.data);
  const response = paginate(records.map(contact => ({ ...contact, status: normalizeCrmStatus(contact.status) })), result.total, { page: result.page, limit: result.limit });
  return { ...response, meta: { ...response.meta, facets: result.facets } };
}

export async function getContactById(id: string, tenantId: string) {
  const contact = await repo.findContactById(id, tenantId);
  if (!contact) throw new NotFoundError('Contact');
  return presentContact(tenantId, contact);
}

export async function createContact(tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  dto = CreateClientContactSchema.parse(dto);
  const { contact, replayed } = await repo.createContact(tenantId, dto, actorId);
  return { contact: await presentContact(tenantId, contact), replayed };
}

export async function updateContact(id: string, tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  const input = dto;
  return salesTransaction(async () => {
  dto = UpdateClientContactSchema.parse(input);
  const before = await repo.findContactById(id, tenantId);
  if (!before) throw new NotFoundError('Contact');
  await assertContactAccountSelection(salesContext.getStore() ?? prisma, tenantId, dto.accountId, before.accountId);
  await validateLinks(tenantId, dto, before.accountId);
  const withCustomChanges = await customFieldChangeTracker(tenantId, 'contacts', id, dto.customFieldValues);
  const contact = await repo.updateContact(id, tenantId, dto, actorId);
  if (!contact) throw new NotFoundError('Contact');
  const presented = await presentContact(tenantId, contact);
  const eventId = randomUUID();
  if (actorId) {
    await writeAuditLog({ tenantId, userId: actorId, action: 'contact.updated', entityType: 'Contact', entityId: id });
    if (contact.status !== before.status && !presented.statusManagedByDeals) await fireContactStatusChanged({ tenantId, actorId, eventId, contact, prevStatus: before.status });
  }
  const previous = presented.statusManagedByDeals ? { ...before, status: contact.status } : before;
  const changes = await withCustomChanges(recordChanges(previous, contact));
  if (changes.changedFields.length) await fireContactUpdated({ tenantId, actorId, eventId, record: contact, changedFields: changes.changedFields, changes });
  return presented;
  });
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  const result = await repo.archiveContact(id, tenantId, userId);
  if (!result.count) throw new NotFoundError('Active Contact');
  await writeAuditLog({ tenantId, userId, action: 'contact.archived',
    entityType: 'Contact', entityId: id, after: { isArchived: true } });
}

export async function restoreContact(id: string, tenantId: string, userId: string) {
  const result = await repo.restoreContact(id, tenantId);
  if (!result.count) throw new NotFoundError('Archived Contact');
  await writeAuditLog({ tenantId, userId, action: 'contact.restored',
    entityType: 'Contact', entityId: id, after: { isArchived: false } });
}

async function validateLinks(tenantId: string, dto: Record<string, unknown>, previousAccountId: string | null) {
  if (dto.accountId && dto.accountId !== previousAccountId && !await (salesContext.getStore() ?? prisma).account.findFirst({ where: { id: String(dto.accountId), tenantId, isArchived: false, deletedAt: null } })) throw new NotFoundError('Account');
  if (dto.assignedUserId && !await (salesContext.getStore() ?? prisma).user.findFirst({ where: { id: String(dto.assignedUserId), tenantId, status: 'ACTIVE' } })) throw new NotFoundError('User');
}
