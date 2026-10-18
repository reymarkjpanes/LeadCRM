import { createHash } from 'node:crypto';
import { createLinkedAccount } from '../companies/organization-creation';
import type { Prisma } from '@prisma/client';
import { CrmStatusSchema } from '@leadcrm/shared';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { assertCrmCreateAssignment, runCrmAutomaticCreation } from '../access/crm-record-access.service';
import { productRelationData } from '../leads/product-relations';
import { normalizeProductOther } from '../leads/product-snapshots';
import { createProductDeals, resolveSalesAgent } from '../leads/lead-automation.service';
import { saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { fireContactCreated } from '../../automation/triggers/triggers.service';
import { assertContactAccountSelection } from './contact-account-access';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** One policy for API and import creation; conversion deliberately never calls it. */
export async function createAssignedContact(tx: Prisma.TransactionClient, tenantId: string, dto: Record<string, unknown>, actorId: string, requestId: string) {
  const { requestId: _requestId, ...intent } = dto;
  for (const field of ['productInterestIds', 'productInterests']) {
    if (Array.isArray(intent[field])) intent[field] = [...new Set(intent[field] as string[])].sort();
  }
  intent.status ??= 'Warm';
  const requestHash = createHash('sha256').update(JSON.stringify(canonical(intent))).digest('hex');
  const receipt = await tx.contactCreationReceipt.findUnique({ where: { tenantId_requestId: { tenantId, requestId } } });
  if (receipt) {
    if (receipt.actorId !== actorId || receipt.requestHash !== requestHash) throw new ConflictError('This Contact request ID belongs to different input. Use a new request ID.');
    const contact = await tx.contact.findFirst({ where: { tenantId, id: receipt.contactId, isArchived: false, deletedAt: null }, include: { assignedUser: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true, industry: true, size: true, website: true } } } });
    if (!contact) throw new NotFoundError('Contact');
    return { contact, replayed: true };
  }
  await assertCrmCreateAssignment(tx, tenantId, dto.assignedUserId);
  await assertContactAccountSelection(tx, tenantId, dto.accountId);
  const status = CrmStatusSchema.parse(dto.status ?? 'Warm');
  if (status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before setting Closed.');
  const selectedAccount = dto.accountId ? await tx.account.findFirst({ where: { tenantId, id: String(dto.accountId), isArchived: false, deletedAt: null }, select: { name: true } }) : null;
  if (dto.accountId && !selectedAccount) throw new NotFoundError('Account');
  const relations = await productRelationData(tx, 'contact', tenantId, { ids: dto.productInterestIds as string[] | undefined, names: dto.productInterests as string[] | undefined });
  const products = await tx.productInterest.findMany({ where: { tenantId, id: { in: relations.productLinks.create.map(link => link.productInterestId) }, active: true } });
  const data = { ...intent };
  normalizeProductOther(data, products.map(product => product.name));
  const { customFieldValues, productInterestIds: _ids, productInterests: _names, assignedUserId: _assignee, newAccount, ...fields } = data;
  if (selectedAccount) { fields.companyName = selectedAccount.name; fields.companyFromAccount = true; }
  if (newAccount) {
    const account = await createLinkedAccount(tx, tenantId, newAccount, actorId);
    fields.accountId = account.id; fields.companyName = account.name; fields.companyFromAccount = true;
  }
  const agent = await resolveSalesAgent(tx, tenantId, dto.assignedUserId as string | null | undefined, ['contacts', 'deals']);
  const contact = await runCrmAutomaticCreation(tx, 'contacts', agent?.id ?? null, () => tx.contact.create({
    data: { ...fields, ...relations, tenantId, status: status.toUpperCase(), assignedUserId: agent?.id ?? null } as Prisma.ContactUncheckedCreateInput,
    include: { assignedUser: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true, industry: true, size: true, website: true } } },
  }));
  await saveRecordValues(tx, tenantId, 'contacts', contact.id, customFieldValues, actorId);
  await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'contact.created', entityType: 'Contact', entityId: contact.id } });
  await tx.activity.create({ data: { tenantId, contactId: contact.id, createdById: actorId, type: 'contact_action', title: 'Contact created', description: agent ? 'Contact saved with an eligible Assigned Agent.' : 'Contact saved as Unassigned.' } });
  await fireContactCreated({ tenantId, actorId, contact });
  await createProductDeals(tx, tenantId, contact.id, actorId, 'contact');
  await tx.contactCreationReceipt.create({ data: { tenantId, requestId, actorId, requestHash, contactId: contact.id } });
  return { contact, replayed: false };
}
