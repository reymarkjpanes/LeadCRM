import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RECORD_FILE_MAX_BYTES } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { recordText } from '../record-validation';

export type FileModule = 'leads' | 'contacts' | 'accounts' | 'deals';
const links = { leads: 'leadId', contacts: 'contactId', accounts: 'accountId', deals: 'dealId' } as const;
const actor = { uploadedBy: { select: { firstName: true, lastName: true } } } as const;
const types = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/zip', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const;
export const UploadMetadataSchema = z.object({ name: recordText(255).pipe(z.string().min(1)).transform(value => value.replace(/[\\/]/g, '_')), type: z.union([z.enum(types), z.literal('application/octet-stream')]) });

function storage() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_RECORD_FILES_BUCKET: bucket } = process.env;
  if (!url || !key || !bucket) throw new AppError('Record file storage is not configured. Contact your administrator.', 503);
  return { base: `${url.replace(/\/$/, '')}/storage/v1/object`, bucket: encodeURIComponent(bucket), headers: { Authorization: `Bearer ${key}`, apikey: key } };
}
async function requireRecord(module: FileModule, id: string, tenantId: string) {
  const where = { id, tenantId, isArchived: false, deletedAt: null };
  const record = module === 'leads' ? await prisma.lead.findFirst({ where }) : module === 'contacts' ? await prisma.contact.findFirst({ where }) : module === 'deals' ? await prisma.deal.findFirst({ where }) : await prisma.account.findFirst({ where });
  if (!record) throw new AppError('Record not found.', 404);
  return record;
}
function metadata(file: { id: string; name: string; size: number; type: string; uploadedAt: Date; uploadedBy: { firstName: string; lastName: string } }, module: FileModule, recordId: string) {
  return { id: file.id, name: file.name, size: file.size, type: file.type, uploadedAt: file.uploadedAt.toISOString(), uploadedBy: `${file.uploadedBy.firstName} ${file.uploadedBy.lastName}`, url: `/api/proxy/crm/${module}/${encodeURIComponent(recordId)}/files/${file.id}/download` };
}
export async function listFiles(module: FileModule, id: string, tenantId: string) {
  await requireRecord(module, id, tenantId);
  const files = await prisma.recordFile.findMany({ where: { tenantId, [links[module]]: id }, include: actor, orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }] });
  return files.map(file => metadata(file, module, id));
}
export async function uploadFile(module: FileModule, id: string | null, tenantId: string, userId: string, input: unknown, bytes: Buffer) {
  if (id) await requireRecord(module, id, tenantId);
  const submitted = UploadMetadataSchema.parse(input);
  const extension = submitted.name.split('.').pop()?.toLowerCase();
  const inferred: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', doc: 'application/msword', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const data = { ...submitted, type: submitted.type === 'application/octet-stream' ? inferred[extension ?? ''] ?? submitted.type : submitted.type };
  if (!(types as readonly string[]).includes(data.type)) throw new AppError('This file type is not supported.', 400);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > RECORD_FILE_MAX_BYTES) throw new AppError('Choose a nonempty file no larger than 10 MB.', 400);
  // Refuse mislabeled binary files. Downloads always use attachment + nosniff.
  const signature = bytes.subarray(0, 12);
  const valid = data.type === 'application/pdf' ? signature.subarray(0, 5).toString() === '%PDF-'
    : data.type === 'image/png' ? signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : data.type === 'image/jpeg' ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
    : data.type === 'image/webp' ? signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP'
    : data.type.startsWith('text/') ? !bytes.includes(0)
    : data.type.includes('openxmlformats') || data.type === 'application/zip' ? signature[0] === 80 && signature[1] === 75
    : signature.subarray(0, 4).equals(Buffer.from([208,207,17,224]));
  if (!valid) throw new AppError('File contents do not match the selected file type.', 400);
  const config = storage();
  if (!id) {
    // Expired drafts cannot be claimed. Remove only this uploader's abandoned
    // drafts; record attachments and historical values are never cleanup targets.
    const expired = await prisma.recordFile.findMany({ where: { tenantId, uploadedById: userId, pendingModule: { not: null }, uploadedAt: { lte: new Date(Date.now() - 86400000) } }, take: 100 });
    if (expired.length) {
      const removed = await fetch(`${config.base}/${config.bucket}`, { method: 'DELETE', headers: { ...config.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: expired.map(file => file.objectKey) }), signal: AbortSignal.timeout(15000) });
      if (removed.ok) await prisma.recordFile.deleteMany({ where: { tenantId, uploadedById: userId, pendingModule: { not: null }, id: { in: expired.map(file => file.id) } } });
    }
    if (await prisma.recordFile.count({ where: { tenantId, uploadedById: userId, pendingModule: { not: null } } }) >= 100) throw new AppError('Too many unfinished file uploads. Save your current records or retry after old drafts expire.', 400);
  }
  const fileId = randomUUID();
  const key = `${encodeURIComponent(tenantId)}/${module}/${encodeURIComponent(id ?? `pending-${userId}`)}/${fileId}`;
  const response = await fetch(`${config.base}/${config.bucket}/${key}`, { method: 'POST', headers: { ...config.headers, 'Content-Type': data.type, 'x-upsert': 'false' }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new AppError('Unable to upload file. Please try again.', 502);
  try {
    const file = await prisma.$transaction(async tx => {
      const saved = await tx.recordFile.create({ data: { id: fileId, tenantId, ...(id ? { [links[module]]: id } : { pendingModule: module }), uploadedById: userId, name: data.name, size: bytes.length, type: data.type, objectKey: key }, include: actor });
      if (id) await tx.activity.create({ data: { tenantId, createdById: userId, [links[module]]: id, type: 'file_upload', title: `Uploaded ${data.name}`, metadata: { fileId } } });
      return saved;
    });
    return { ...metadata(file, module, id ?? ''), ...(!id ? { url: '' } : {}) };
  } catch (error) {
    await fetch(`${config.base}/${config.bucket}`, { method: 'DELETE', headers: { ...config.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15000) }).catch(() => console.warn('Unable to clean up uncommitted record file'));
    throw error;
  }
}
export async function downloadFile(module: FileModule, id: string, tenantId: string, fileId: string) {
  await requireRecord(module, id, tenantId);
  const file = await prisma.recordFile.findFirst({ where: { id: fileId, tenantId, [links[module]]: id } });
  if (!file) throw new AppError('File not found.', 404);
  const config = storage();
  const response = await fetch(`${config.base}/authenticated/${config.bucket}/${file.objectKey}`, { headers: config.headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new AppError('Unable to download file. Please try again.', 502);
  return { name: file.name, bytes: Buffer.from(await response.arrayBuffer()) };
}
