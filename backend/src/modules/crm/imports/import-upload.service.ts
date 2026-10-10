import { createHash } from 'node:crypto';
import { CsvUploadChunkSchema, CSV_MAX_BYTES, type CreateCrmImportInput, type CrmImportModule } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ConflictError, ValidationError } from '../../../shared/errors/http-error';
import { salesTransaction } from '../leads/lead-automation.service';
import { importModules } from './import-modules';

const uploadScope = (tenantId: string, actorId: string, module: CrmImportModule) => ({ tenantId, actorId, module: importModules[module] });
export const csvDigest = (source: string) => createHash('sha256').update(source).digest('hex');

export async function saveCsvChunk(tenantId: string, actorId: string, module: CrmImportModule, input: unknown) {
  const chunk = CsvUploadChunkSchema.parse(input), scope = uploadScope(tenantId, actorId, module);
  await prisma.crmImportUpload.deleteMany({ where: { tenantId, actorId, expiresAt: { lte: new Date() } } });
  await salesTransaction(async tx => {
    let upload = await tx.crmImportUpload.findFirst({ where: { ...scope, id: chunk.uploadId }, include: { chunks: true, job: { select: { completedAt: true } } } });
    if (!upload) {
      // UUIDs identify one scoped upload, never a module-specific staging table.
      await tx.crmImportUpload.create({ data: { ...scope, id: chunk.uploadId, totalChunks: chunk.totalChunks, expiresAt: new Date(Date.now() + 86400000) } });
      upload = await tx.crmImportUpload.findFirstOrThrow({ where: { ...scope, id: chunk.uploadId }, include: { chunks: true, job: { select: { completedAt: true } } } });
    }
    if (upload.expiresAt <= new Date() || upload.job?.completedAt) throw new ConflictError('CSV upload expired or already imported. Select the file again.');
    if (upload.totalChunks !== chunk.totalChunks) throw new ConflictError('Inconsistent CSV upload.');
    const existing = upload.chunks.find(c => c.chunkIndex === chunk.chunkIndex);
    if (existing) {
      if (existing.content !== chunk.content) throw new ConflictError('CSV upload changed. Select the file again.');
      return;
    }
    if (upload.chunks.reduce((size, c) => size + Buffer.byteLength(c.content), Buffer.byteLength(chunk.content)) > CSV_MAX_BYTES) throw new ValidationError('CSV exceeds the 10MB limit.');
    await tx.crmImportUpload.update({ where: { ...scope, id: upload.id }, data: {
      chunks: { create: { chunkIndex: chunk.chunkIndex, content: chunk.content } },
    } });
  });
}

export async function readCsvSource(tenantId: string, actorId: string, module: CrmImportModule, dto: CreateCrmImportInput) {
  if (dto.csvText !== undefined) return dto.csvText;
  const upload = await prisma.crmImportUpload.findFirst({ where: { ...uploadScope(tenantId, actorId, module), id: dto.uploadId, expiresAt: { gt: new Date() } }, include: { chunks: { orderBy: { chunkIndex: 'asc' } } } });
  if (!upload || upload.chunks.length !== upload.totalChunks || upload.chunks.some((c, i) => c.chunkIndex !== i)) throw new ValidationError('CSV upload is incomplete or expired. Select the file again.');
  const source = upload.chunks.map(c => c.content).join('');
  if (Buffer.byteLength(source) > CSV_MAX_BYTES) throw new ValidationError('CSV exceeds the 10MB limit.');
  const digest = csvDigest(source);
  if (upload.sourceHash && upload.sourceHash !== digest) throw new ConflictError('CSV upload changed. Select the file again.');
  if (!upload.sourceHash) await prisma.crmImportUpload.update({ where: { id: upload.id, ...uploadScope(tenantId, actorId, module) }, data: { sourceHash: digest } });
  return source;
}

export async function sourceDigest(tenantId: string, actorId: string, module: CrmImportModule, dto: CreateCrmImportInput) {
  if (dto.csvText !== undefined) return csvDigest(dto.csvText);
  const upload = await prisma.crmImportUpload.findFirst({ where: { ...uploadScope(tenantId, actorId, module), id: dto.uploadId, expiresAt: { gt: new Date() } } });
  if (upload?.sourceHash) return upload.sourceHash;
  return csvDigest(await readCsvSource(tenantId, actorId, module, dto));
}

// Keep only the short-lived source digest for a completed job's network retry.
export async function releaseCsvSource(tenantId: string, actorId: string, module: CrmImportModule, uploadId?: string) {
  if (uploadId) await prisma.crmImportChunk.deleteMany({ where: { uploadId, upload: uploadScope(tenantId, actorId, module) } });
}
