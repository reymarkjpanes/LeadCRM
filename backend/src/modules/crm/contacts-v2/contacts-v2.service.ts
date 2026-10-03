import { CreateClientContactSchema, UpdateClientContactSchema } from './contacts-v2.dto';
import { normalizeCrmStatus } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import * as repo from './contacts-v2.repository';
import { NotFoundError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import { fireContactCreated, fireContactStatusChanged, fireContactUpdated } from '../../automation/triggers/triggers.service';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { recordChanges } from '../record-updates';

export async function getContacts(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllContacts(tenantId, query);
  return paginate(result.data.map(contact => ({ ...contact, status: normalizeCrmStatus(contact.status) })), result.total, { page: result.page, limit: result.limit });
}

export async function getContactById(id: string, tenantId: string) {
  const contact = await repo.findContactById(id, tenantId);
  if (!contact) throw new NotFoundError('Contact');
  return { ...contact, status: normalizeCrmStatus(contact.status) };
}

export async function createContact(tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  dto = CreateClientContactSchema.parse(dto);
  await validateLinks(tenantId, dto);
  const contact = await repo.createContact(tenantId, dto);
  if (actorId) {
    await writeAuditLog({ tenantId, userId: actorId, action: 'contact.created', entityType: 'Contact', entityId: contact.id });
    await fireContactCreated({ tenantId, actorId, contact });
  }
  return { ...contact, status: normalizeCrmStatus(contact.status) };
}

export async function updateContact(id: string, tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  dto = UpdateClientContactSchema.parse(dto);
  await validateLinks(tenantId, dto);
  const before = await repo.findContactById(id, tenantId);
  if (!before) throw new NotFoundError('Contact');
  const contact = await repo.updateContact(id, tenantId, dto, actorId);
  if (!contact) throw new NotFoundError('Contact');
  if (actorId) {
    await writeAuditLog({ tenantId, userId: actorId, action: 'contact.updated', entityType: 'Contact', entityId: id });
    if (contact.status !== before.status) await fireContactStatusChanged({ tenantId, actorId, contact, prevStatus: before.status });
  }
  const changes = recordChanges(before, contact);
  if (changes.changedFields.length) await fireContactUpdated({ tenantId, actorId, record: contact, changedFields: changes.changedFields, changes });
  return { ...contact, status: normalizeCrmStatus(contact.status) };
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

async function validateLinks(tenantId: string, dto: Record<string, unknown>) {
  if (dto.accountId && !await prisma.account.findFirst({ where: { id: String(dto.accountId), tenantId, isArchived: false } })) throw new NotFoundError('Account');
  if (dto.assignedUserId && !await prisma.user.findFirst({ where: { id: String(dto.assignedUserId), tenantId, status: 'ACTIVE' } })) throw new NotFoundError('User');
}
