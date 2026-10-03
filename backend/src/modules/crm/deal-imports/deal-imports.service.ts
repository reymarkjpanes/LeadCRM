import { CreateDealImportSchema, ImportDealRowSchema, type ImportDealRow, type CreateDealImportInput } from '@leadcrm/shared';
import * as repo from './deal-imports.repository';
import { CreateDealSchema } from '../deals/deals.dto';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { paginate } from '../../../shared/helpers/pagination';

function unique<T extends { id: string }>(records: T[], label: string): T {
  if (records.length !== 1) throw new ValidationError(`${label} was not found or is ambiguous in this workspace. Use its ID.`);
  return records[0];
}

export async function resolveRow(tenantId: string, row: ImportDealRow) {
  const pipeline = unique(await repo.findPipelines(tenantId, row.pipeline), 'Pipeline');
  const stage = unique(await repo.findStages(tenantId, pipeline.id, row.stage), 'Stage');
  if (stage.isWon) throw new ValidationError('Import into an open stage, then confirm Closed Won with the required business evidence.');
  const account = row.account ? unique(await repo.findAccounts(tenantId, row.account), 'Account') : null;
  const contact = row.contact ? unique(await repo.findContacts(tenantId, row.contact), 'Contact') : null;
  const assignee = row.assignedUser ? unique(await repo.findUsers(tenantId, row.assignedUser), 'Assigned user') : null;
  return CreateDealSchema.parse({
    title: row.title, pipelineId: pipeline.id, stageId: stage.id,
    value: row.value ? Number(row.value) : undefined, priority: row.priority,
    expectedCloseDate: row.expectedCloseDate ? `${row.expectedCloseDate}T00:00:00.000Z` : undefined,
    accountId: account?.id,
    contactIds: contact ? [contact.id] : undefined, assignedUserId: assignee?.id,
  });
}

export async function processImport(tenantId: string, actorId: string, input: CreateDealImportInput) {
  const dto = CreateDealImportSchema.parse(input);
  const job = await repo.createImport(tenantId, actorId, dto.fileName, dto.rows.length);
  let success = 0;
  let failed = 0;
  try {
    for (const raw of dto.rows) {
      const { rowNumber, ...data } = raw;
      const parsed = ImportDealRowSchema.safeParse(data);
      let remarks: string | undefined;
      let deal;
      if (!parsed.success) remarks = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      else {
        try { deal = await resolveRow(tenantId, parsed.data); }
        catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          remarks = error.message;
        }
      }
      await repo.saveRow(tenantId, actorId, { importId: job.id, rowNumber, data, remarks }, deal);
      if (deal) success++; else failed++;
    }
    const status = failed === 0 ? 'completed' : success === 0 ? 'failed' : 'completed_with_errors';
    const result = await repo.finishImport(job.id, tenantId, success, failed, status);
    await writeAuditLog({ tenantId, userId: actorId, action: 'deals.import', entityType: 'DealImport', entityId: job.id,
      after: { totalRecords: dto.rows.length, successfulRecords: success, failedRecords: failed, status } });
    return result;
  } catch (error) {
    await repo.finishImport(job.id, tenantId, success, dto.rows.length - success, 'failed');
    throw error;
  }
}
export async function getImportById(id: string, tenantId: string) {
  const record = await repo.findImport(id, tenantId);
  if (!record) throw new NotFoundError('Deal import');
  return record;
}
export async function listImports(tenantId: string, query: { page: number; limit: number }) {
  const result = await repo.listImports(tenantId, query.page, query.limit);
  return paginate(result.data, result.total, query);
}
export async function listImportResults(id: string, tenantId: string, query: { page: number; limit: number; status?: string }) {
  await getImportById(id, tenantId);
  const result = await repo.listResults(id, query.page, query.limit, query.status);
  return paginate(result.data, result.total, query);
}
