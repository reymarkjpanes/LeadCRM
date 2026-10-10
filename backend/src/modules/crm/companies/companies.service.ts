import * as repo from './companies.repository';
import { writeAuditLog, buildChangeset } from '../../../core/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/http-error';
import { CreateCompanyDto, UpdateCompanyDto, CreateCompanySchema, UpdateCompanySchema } from './companies.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireAccountUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges, customFieldChangeTracker } from '../record-updates';

export async function getCompanies(tenantId: string, query: Record<string, unknown>) {
  const result = await repo.findAllCompanies(tenantId, query);
  return paginate(result.data, result.total, { page: result.page, limit: result.limit });
}

export async function getCompanyById(id: string, tenantId: string) {
  const company = await repo.findCompanyById(id, tenantId);
  if (!company) throw new NotFoundError('Company');
  return company;
}

export async function createCompany(tenantId: string, userId: string, dto: CreateCompanyDto) {
  dto = CreateCompanySchema.parse(dto);
  const company = await repo.createCompany(tenantId, dto, userId);
  await writeAuditLog({
    tenantId, userId,
    action: 'account.created', entityType: 'Account', entityId: company.id,
    after: { name: dto.name, industry: dto.industry },
  });
  return company;
}

export async function updateCompany(
  id: string, tenantId: string, userId: string, dto: UpdateCompanyDto,
) {
  dto = UpdateCompanySchema.parse(dto);
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
