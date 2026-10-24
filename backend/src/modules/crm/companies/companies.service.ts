import { salesContext } from '../leads/sales-context';
import { createHash } from 'node:crypto';
import * as repo from './companies.repository';
import { writeAuditLog, buildChangeset } from '../../../core/audit/audit.service';
import { ConflictError, NotFoundError } from '../../../shared/errors/http-error';
import { CreateCompanyDto, UpdateCompanyDto, CreateCompanySchema, UpdateCompanySchema } from './companies.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireAccountUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges, customFieldChangeTracker } from '../record-updates';
import { salesTransaction } from '../leads/lead-automation.service';

export async function getCompanies(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllCompanies(tenantId, query);
  return { ...paginate(result.data, result.total, { page: result.page, limit: result.limit }), facets: result.facets };
}

export async function getCompanyById(id: string, tenantId: string) {
  const company = await repo.findCompanyById(id, tenantId);
  if (!company) throw new NotFoundError('Company');
  return repo.withCompanyDealSummary(tenantId, company);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** Standalone, linked and conversion creation share validation, transaction and audit rules. */
export async function createCompanyResult(tenantId: string, userId: string, input: CreateCompanyDto, ownerGroupId?: string | null) {
  const { requestId, ...fields } = CreateCompanySchema.parse(input);
  // Historical linked records retain their access scope through trusted callers only.
  const dto = { ...fields, ...(ownerGroupId !== undefined ? { ownerGroupId } : {}) };
  // Existing receipts already omitted empty native tags from their canonical payload.
  const requestHash = createHash('sha256').update(JSON.stringify(canonical(dto))).digest('hex');
  return salesTransaction(async tx => {
    if (requestId) {
      const receipt = await tx.accountCreationReceipt.findUnique({ where: { tenantId_requestId: { tenantId, requestId } } });
      if (receipt) {
        if (receipt.actorId !== userId || receipt.requestHash !== requestHash) throw new ConflictError('This Account request ID belongs to different input. Use a new request ID.');
        const company = await tx.account.findFirst({ where: { id: receipt.accountId, tenantId, isArchived: false, deletedAt: null } });
        if (!company) throw new NotFoundError('Active Account');
        return { company, replayed: true };
      }
    }
    const company = await repo.createCompany(tenantId, dto, userId);
    await writeAuditLog({ tenantId, userId, action: 'account.created', entityType: 'Account', entityId: company.id,
      after: { name: dto.name, industry: dto.industry } });
    if (requestId) await tx.accountCreationReceipt.create({ data: { tenantId, requestId, actorId: userId, requestHash, accountId: company.id } });
    return { company, replayed: false };
  });
}

export async function createCompany(tenantId: string, userId: string, dto: CreateCompanyDto, ownerGroupId?: string | null) {
  return (await createCompanyResult(tenantId, userId, dto, ownerGroupId)).company;
}

export async function updateCompany(
  id: string, tenantId: string, userId: string, dto: UpdateCompanyDto,
) {
  const input = dto;
  return salesTransaction(async () => {
  dto = UpdateCompanySchema.parse(input);
  const before = await repo.findCompanyById(id, tenantId);
  if (!before) throw new NotFoundError('Company');
  const withCustomChanges = await customFieldChangeTracker(tenantId, 'accounts', id, dto.customFieldValues);

  const company = await repo.updateCompany(id, tenantId, dto, userId);
  if (!company) throw new NotFoundError('Company');

  const { before: cb, after: ca } = buildChangeset(
    before as unknown as Record<string, unknown>,
    company as unknown as Record<string, unknown>,
  );
  await writeAuditLog({
    tenantId, userId,
    action: 'account.updated', entityType: 'Account', entityId: id,
    before: cb, after: ca,
  });
  const changes = await withCustomChanges(recordChanges(before, company));
  if (changes.changedFields.length) await fireAccountUpdated({ tenantId, actorId: userId, record: company, changedFields: changes.changedFields, changes });
  return company;
  });
}

export async function archiveCompany(id: string, tenantId: string, userId: string) {
  const result = await repo.archiveCompany(id, tenantId, userId);
  if (!result.count) throw new NotFoundError('Active Account');
  await writeAuditLog({ tenantId, userId, action: 'account.archived',
    entityType: 'Account', entityId: id, after: { isArchived: true } });
}

export async function restoreCompany(id: string, tenantId: string, userId: string) {
  const result = await repo.restoreCompany(id, tenantId);
  if (!result.count) throw new NotFoundError('Archived Account');
  await writeAuditLog({ tenantId, userId, action: 'account.restored',
    entityType: 'Account', entityId: id, after: { isArchived: false } });
}
