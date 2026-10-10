import { readCsvSource, saveCsvChunk, releaseCsvSource, sourceDigest } from './import-upload.service';
import { createHash } from 'node:crypto';
import { CreateCrmImportSchema, mapImportCsv, type CrmImportModule, type CreateCrmImportInput, type ImportReviewRow } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import { salesTransaction } from '../leads/lead-automation.service';
import { createImportRow, duplicateCsvRows, validateImportRow } from './import-rows.service';
import { importStore, type ImportQuery } from './imports.repository';

async function prepare(module: CrmImportModule, tenantId: string, actorId: string, input: CreateCrmImportInput) {
  const dto = CreateCrmImportSchema.parse(input);
  const csvText = await readCsvSource(tenantId, actorId, module, dto);
  try { return { dto, rows: mapImportCsv(module, { ...dto, csvText }) }; }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid CSV.'); }
}

async function requestIdentity(module: CrmImportModule, tenantId: string, actorId: string, input: CreateCrmImportInput) {
  const dto = CreateCrmImportSchema.parse(input);
  const digest = await sourceDigest(tenantId, actorId, module, dto);
  const mappings = Object.entries(dto.mappings).sort(([a], [b]) => a.localeCompare(b));
  return { dto, requestHash: createHash('sha256').update(JSON.stringify([actorId, dto.fileName, mappings, digest])).digest('hex') };
}

export function moduleImportService(module: CrmImportModule) {
  const storeFor = (tenantId: string) => importStore(prisma, module, tenantId);
  return {
    uploadCsv: (tenantId: string, actorId: string, input: unknown) => saveCsvChunk(tenantId, actorId, module, input),
    async previewImport(tenantId: string, actorId: string, input: CreateCrmImportInput, offset = 0): Promise<ImportReviewRow[]> {
      const { rows } = await prepare(module, tenantId, actorId, input), duplicates = duplicateCsvRows(module, rows);
      const result: ImportReviewRow[] = [];
      for (const raw of rows.slice(offset, offset + 25)) {
        const { products, deal, ...review } = await validateImportRow(prisma, module, tenantId, raw, duplicates.get(raw.rowNumber));
        result.push(review);
      }
      return result;
    },
    async getRequestImport(tenantId: string, actorId: string, input: CreateCrmImportInput) {
      const { dto, requestHash } = await requestIdentity(module, tenantId, actorId, input);
      const job = await storeFor(tenantId).findKey(dto.idempotencyKey);
      if (job && job.requestHash !== requestHash) throw new ConflictError('This import key belongs to a different request. Start a New import.');
      return job;
    },
    async processImport(tenantId: string, actorId: string, input: CreateCrmImportInput) {
      const { dto, requestHash } = await requestIdentity(module, tenantId, actorId, input);
      const existing = await storeFor(tenantId).findKey(dto.idempotencyKey);
      if (existing && existing.requestHash !== requestHash) throw new ConflictError('This import key belongs to a different request. Start a New import.');
      if (existing?.completedAt) { await releaseCsvSource(tenantId, actorId, module, dto.uploadId); return existing; }
      const { rows } = await prepare(module, tenantId, actorId, input);
      const job = await salesTransaction(async tx => {
        const db = importStore(tx, module, tenantId);
        const previous = await db.findKey(dto.idempotencyKey);
        if (previous) {
          if (previous.requestHash !== requestHash) throw new ConflictError('This import key belongs to a different request. Start a New import to change the file or mapping.');
          return previous;
        }
        return db.create({ createdById: actorId, fileName: dto.fileName, totalRecords: rows.length,
          idempotencyKey: dto.idempotencyKey, requestHash, status: 'importing', uploadId: dto.uploadId });
      });
      if (job.completedAt) { await releaseCsvSource(tenantId, actorId, module, dto.uploadId); return job; }
      const duplicates = duplicateCsvRows(module, rows);
      const committed = new Set((await storeFor(tenantId).rows(job.id)).map(r => r.rowNumber));
      // Bounded, resumable requests avoid holding one transaction or HTTP request for 5000 rows.
      for (const raw of rows.filter(r => !committed.has(r.rowNumber)).slice(0, 25)) {
        await salesTransaction(async tx => {
          const db = importStore(tx, module, tenantId);
          if (await db.row(job.id, raw.rowNumber)) return;
          const review = await validateImportRow(tx, module, tenantId, raw, duplicates.get(raw.rowNumber));
          const entityId = review.isValid ? await createImportRow(tx, module, tenantId, actorId, job.id, review) : undefined;
          await db.save({ importId: job.id, rowNumber: raw.rowNumber, entityId,
            status: review.isValid ? 'imported' : review.status === 'duplicate' ? 'duplicate' : 'failed',
            remarks: review.errors.length ? review.errors.join('; ') : undefined,
            data: { ...review.data, ...(review.resolvedValue === undefined ? {} : { resolvedValue: String(review.resolvedValue) }) },
          });
          // Persist accurate progress atomically with each record (including automatic Deals).
          const outcomes = await db.rows(job.id);
          const successfulRecords = outcomes.filter(r => r.status === 'imported').length;
          const failedRecords = outcomes.filter(r => r.status === 'failed').length;
          const duplicateRecords = outcomes.filter(r => r.status === 'duplicate').length;
          const done = outcomes.length === rows.length;
          const status = !done ? 'importing' : failedRecords + duplicateRecords === 0 ? 'completed' : successfulRecords ? 'completed_with_errors' : 'failed';
          await db.update(job.id, { successfulRecords, failedRecords, duplicateRecords, status, completedAt: done ? new Date() : null });
          if (done) await tx.auditLog.create({ data: { tenantId, userId: actorId, action: `${module}.import`, entityType: 'CrmImportJob', entityId: job.id,
            metadata: { module, totalRecords: rows.length, successfulRecords, failedRecords, duplicateRecords, status } } });
        });
      }
      const result = (await storeFor(tenantId).find(job.id))!;
      if (result.completedAt) await releaseCsvSource(tenantId, actorId, module, dto.uploadId);
      return result;
    },
    async getImportById(id: string, tenantId: string) {
      const record = await storeFor(tenantId).find(id);
      if (!record) throw new NotFoundError('Import');
      return record;
    },
    async listImports(tenantId: string, query: ImportQuery) {
      const [data, total] = await Promise.all([storeFor(tenantId).list(query), storeFor(tenantId).count(query.status)]);
      return paginate(data, total, query);
    },
    async listImportResults(id: string, tenantId: string, query: ImportQuery) {
      if (!await storeFor(tenantId).find(id)) throw new NotFoundError('Import');
      const [rows, total] = await Promise.all([storeFor(tenantId).results(id, query), storeFor(tenantId).countResults(id, query.status)]);
      const recordKey = { leads: 'leadId', contacts: 'contactId', accounts: 'accountId', deals: 'dealId' }[module];
      // Preserve module API aliases while keeping one relational result contract.
      const data = rows.map(row => ({ ...(row.data as Record<string, unknown>), ...row,
        importId: row.importJobId, [recordKey]: row.recordId,
      }));
      return paginate(data, total, query);
    },
  };
}
