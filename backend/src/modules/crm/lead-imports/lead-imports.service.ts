import * as repo from './lead-imports.repository';
import { ImportLeadRowSchema, CreateLeadImportDto } from './lead-imports.dto';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/http-error';
import prisma from '../../../config/database.config';
import { createAssignedLead, salesTransaction } from '../leads/lead-automation.service';
import { paginate } from '../../../shared/helpers/pagination';

/**
 * Process a lead import: validate each row, create valid leads, record results.
 * Reuses the same Prisma Lead creation logic as the single-lead endpoint.
 */
export async function processImport(
  tenantId: string,
  userId: string,
  dto: CreateLeadImportDto,
) {
  // 1. Create import record with "importing" status
  const importRecord = await repo.createImport(tenantId, userId, {
    fileName: dto.fileName,
    totalRecords: dto.rows.length,
  });

  let successCount = 0;
  let failCount = 0;
  const results: Array<{
    importId: string;
    rowNumber: number;
    status: string;
    leadId?: string;
    remarks?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    address?: string;
  }> = [];

  // 2. Process each row
  for (const row of dto.rows) {
    const { rowNumber, ...rowData } = row;

    // Validate row against strict import schema
    const validation = ImportLeadRowSchema.safeParse(rowData);

    if (!validation.success) {
      // Collect all errors for this row
      const errors = validation.error.errors.map((e) => e.message).join('; ');
      failCount++;
      results.push({
        importId: importRecord.id,
        rowNumber,
        status: 'failed',
        remarks: errors,
        firstName: rowData.firstName || undefined,
        lastName: rowData.lastName || undefined,
        email: rowData.email || undefined,
        phone: rowData.phone || undefined,
        companyName: rowData.companyName || undefined,
        address: rowData.address || undefined,
      });
      continue;
    }

    // Check for duplicate email within tenant
    const existingLead = await prisma.lead.findFirst({
      where: { tenantId, email: validation.data.email },
      select: { id: true },
    });

    if (existingLead) {
      failCount++;
      results.push({
        importId: importRecord.id,
        rowNumber,
        status: 'failed',
        remarks: 'A lead with this email already exists.',
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email,
        phone: validation.data.phone,
        companyName: validation.data.companyName,
        address: validation.data.address,
      });
      continue;
    }

    // Use the same transactional assignment flow as manual Lead creation.
    try {
      const lead = await salesTransaction(tx => createAssignedLead(tx, {
          tenantId,
          firstName: validation.data.firstName,
          lastName: validation.data.lastName,
          email: validation.data.email,
          phone: validation.data.phone,
          companyName: validation.data.companyName,
          address: validation.data.address,
          status: validation.data.status || 'Warm',
          website: validation.data.website || undefined,
          source: validation.data.source || undefined,
          description: validation.data.description || undefined,
          createdById: userId,
          updatedById: userId,
          creationKey: `${importRecord.id}:${rowNumber}`,
        }, userId));

      successCount++;
      results.push({
        importId: importRecord.id,
        rowNumber,
        status: 'imported',
        leadId: lead.id,
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email,
        phone: validation.data.phone,
        companyName: validation.data.companyName,
        address: validation.data.address,
      });
    } catch (err) {
      failCount++;
      const message = err instanceof Error ? err.message : 'Unexpected database error';
      results.push({
        importId: importRecord.id,
        rowNumber,
        status: 'failed',
        remarks: message,
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email,
        phone: validation.data.phone,
        companyName: validation.data.companyName,
        address: validation.data.address,
      });
    }
  }

  // 3. Save all results in bulk
  if (results.length > 0) {
    await repo.createImportResults(results);
  }

  // 4. Update import record with final status
  const finalStatus =
    failCount === 0
      ? 'completed'
      : successCount === 0
        ? 'failed'
        : 'completed_with_errors';

  await repo.updateImportStatus(importRecord.id, tenantId, {
    status: finalStatus,
    successfulRecords: successCount,
    failedRecords: failCount,
    completedAt: new Date(),
  });

  // 5. Audit log
  await writeAuditLog({
    tenantId,
    userId,
    action: 'leads.import',
    entityType: 'LeadImport',
    entityId: importRecord.id,
    after: {
      fileName: dto.fileName,
      totalRecords: dto.rows.length,
      successfulRecords: successCount,
      failedRecords: failCount,
      status: finalStatus,
    },
  });

  return {
    id: importRecord.id,
    fileName: dto.fileName,
    totalRecords: dto.rows.length,
    successfulRecords: successCount,
    failedRecords: failCount,
    status: finalStatus,
    createdAt: importRecord.createdAt,
    completedAt: new Date(),
  };
}

/**
 * Get a single import by ID (tenant-scoped).
 */
export async function getImportById(id: string, tenantId: string) {
  const record = await repo.findImportById(id, tenantId);
  if (!record) throw new NotFoundError('LeadImport');
  return record;
}

/**
 * List imports for a tenant (paginated).
 */
export async function listImports(
  tenantId: string,
  query: { page: number; limit: number },
) {
  const result = await repo.findImports(tenantId, query);
  return paginate(result.data, result.total, { page: result.page, limit: result.limit });
}

/**
 * List results for a specific import (paginated, filterable by status).
 */
export async function listImportResults(
  importId: string,
  tenantId: string,
  query: { page: number; limit: number; status?: string },
) {
  const result = await repo.findImportResults(importId, tenantId, query);
  if (!result) throw new NotFoundError('LeadImport');
  return paginate(result.data, result.total, { page: result.page, limit: result.limit });
}
