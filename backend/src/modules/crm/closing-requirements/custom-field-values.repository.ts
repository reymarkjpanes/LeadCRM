import { Prisma, type RecordFile } from '@prisma/client';
import { z } from 'zod';
import { CustomFieldValuesSchema, closingValueError, isClosedWonField, CLOSING_FILE_MAX_BYTES, type ClosingValues, type CustomFieldModule } from '@leadcrm/shared';
import { readFields } from './closing-requirements.repository';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';

type Tx = Prisma.TransactionClient;
export const recordLinks = { leads: 'leadId', contacts: 'contactId', accounts: 'accountId', deals: 'dealId' } as const;
export type BatchFiles = Map<string, RecordFile>;

export async function requireCustomFieldRecord(tx: Tx, tenantId: string, module: CustomFieldModule, id: string, editing = false) {
  const where = { tenantId, id, ...(editing || module === 'leads' ? { isArchived: false, deletedAt: null } : {}) };
  const record = module === 'leads' ? await tx.lead.findFirst({ where }) : module === 'contacts' ? await tx.contact.findFirst({ where }) : module === 'accounts' ? await tx.account.findFirst({ where }) : await tx.deal.findFirst({ where });
  if (!record) throw new NotFoundError('Record');
  if (editing && module === 'leads' && 'convertedAt' in record && record.convertedAt) throw new ValidationError('This Lead has been converted. Update the linked Contact instead.');
  return record;
}

export async function readRecordValues(tx: Tx, tenantId: string, module: CustomFieldModule, recordId: string): Promise<ClosingValues> {
  const rows = await tx.customFieldValue.findMany({ where: { tenantId, module, [recordLinks[module]]: recordId } });
  return Object.fromEntries(rows.map(row => [row.fieldId, row.value])) as ClosingValues;
}

export async function persistValues(tx: Tx, tenantId: string, module: CustomFieldModule, recordId: string, values: ClosingValues) {
  for (const [fieldId, value] of Object.entries(values)) {
    const where = { tenantId, fieldId, module, [recordLinks[module]]: recordId };
    const row = await tx.customFieldValue.findFirst({ where, select: { id: true } });
    const data = { value: value === null ? Prisma.JsonNull : value };
    if (row) await tx.customFieldValue.update({ where: { id: row.id }, data });
    else await tx.customFieldValue.create({ data: { ...where, ...data } });
  }
}

/** Called inside the record mutation's transaction: invalid values roll back the entire save. */
export async function saveRecordValues(tx: Tx, tenantId: string, module: CustomFieldModule, recordId: string, input: unknown, actorId?: string, batchFiles?: BatchFiles) {
  await requireCustomFieldRecord(tx, tenantId, module, recordId, true);
  const patch = CustomFieldValuesSchema.parse(input ?? {});
  const fields = (await readFields(tx, tenantId)).filter(field => field.module === module && !isClosedWonField(field));
  const editable = fields.filter(field => field.active && field.visibleInForm);
  if (Object.keys(patch).some(id => !editable.some(field => field.id === id))) throw new ValidationError('Choose an active, visible custom field belonging to this module.');
  const previous = await readRecordValues(tx, tenantId, module, recordId);
  const normalized: ClosingValues = Object.fromEntries(Object.entries(patch).map(([id, value]) => [id, typeof value === 'string' ? value.trim() || null : value]));
  const values = { ...previous, ...normalized };
  const issues: z.ZodIssue[] = [];
  for (const field of editable) {
    const value = values[field.id];
    // Old optional choices remain readable after configuration edits. Validate changes
    // and all currently required inputs, without rewriting historical values.
    if (!field.required && !Object.prototype.hasOwnProperty.call(patch, field.id)) continue;
    let error = closingValueError(field, value);
    if (!error && field.type === 'File Upload' && value) {
      let file = batchFiles?.get(String(value)) ?? await tx.recordFile.findFirst({ where: { tenantId, id: String(value) } });
      const pending = file?.pendingModule === module && file.uploadedById === actorId && file.uploadedAt.getTime() > Date.now() - 86400000;
      if (!file || !file.objectKey || file.size <= 0 || file.size > CLOSING_FILE_MAX_BYTES || (file[recordLinks[module]] !== recordId && !pending && !batchFiles?.has(String(value)))) {
        error = 'Upload a file for this record before saving.';
      } else if (pending || batchFiles?.has(String(value))) {
        const source = file;
        if (batchFiles?.has(String(value))) {
          // One explicitly submitted batch may attach its uploaded bytes to each Deal.
          file = await tx.recordFile.create({ data: { tenantId, [recordLinks[module]]: recordId, uploadedById: file.uploadedById, name: file.name, size: file.size, type: file.type, objectKey: file.objectKey } });
        } else {
          file = await tx.recordFile.update({ where: { id: file.id }, data: { pendingModule: null, [recordLinks[module]]: recordId } });
          batchFiles?.set(String(value), source);
        }
        normalized[field.id] = file.id;
      }
    }
    if (error) issues.push({ code: 'custom', path: ['customFieldValues', field.id], message: `${field.name}: ${error}` });
  }
  if (issues.length) throw new z.ZodError(issues);
  await persistValues(tx, tenantId, module, recordId, normalized);
  if (actorId && Object.keys(normalized).some(id => previous[id] !== normalized[id])) await tx.auditLog.create({ data: {
    tenantId, userId: actorId, action: 'custom_field.values_updated', entityType: module, entityId: recordId,
    changeset: { before: previous, after: { ...previous, ...normalized } } as Prisma.InputJsonValue,
  } });
  return { ...previous, ...normalized };
}
