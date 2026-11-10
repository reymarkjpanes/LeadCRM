import { Prisma } from '@prisma/client';
import { DEFAULT_CLOSING_FIELDS, closingValueError, CLOSING_FILE_MAX_BYTES, normalizeCustomField, isClosedWonField, type ClosingField, type ClosingValues } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { backfillTechnicalAliases, lockFieldConfiguration, planTechnicalAliases } from './custom-field-aliases';

type Tx = Prisma.TransactionClient;
export const configurationKey = (tenantId: string) => ({ tenantId, module: 'closing-requirements', key: 'fields' });
/** Metadata/validation must not initialize definitions or otherwise write data. */
export async function readConfiguredFields(tx: Tx, tenantId: string): Promise<ClosingField[]> {
  const rows = await tx.closingFieldDefinition.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map(row => normalizeCustomField(row.definition as unknown as ClosingField)).filter(field => !field.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export async function readFields(tx: Tx, tenantId: string, includeRetired = false): Promise<ClosingField[]> {
  await lockFieldConfiguration(tx, tenantId);
  let rows = await tx.closingFieldDefinition.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!rows.length) {
    const now = Date.now();
    await tx.closingFieldDefinition.createMany({ data: DEFAULT_CLOSING_FIELDS.map((field, index) => ({ tenantId, id: field.id, definition: field as unknown as Prisma.InputJsonValue, createdAt: new Date(now - DEFAULT_CLOSING_FIELDS.length + index) })), skipDuplicates: true });
    rows = await tx.closingFieldDefinition.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
  const fields = await backfillTechnicalAliases(tx, tenantId, rows.map(row => normalizeCustomField(row.definition as unknown as ClosingField)));
  return fields.filter(field => includeRetired || !field.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
/** Steady-state display reads must not update the shared configuration lock row.
 * Legacy initialization/backfill still uses the locked write policy. Mutations
 * continue to call readFields so definitions and values retain their write fence.
 */
export async function readFieldsForDisplay(tx: Tx, tenantId: string, includeRetired = false): Promise<ClosingField[]> {
  const rows = await tx.closingFieldDefinition.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const fields = rows.map(row => normalizeCustomField(row.definition as unknown as ClosingField));
  if (!fields.length || fields.some(field => !field.technicalAlias)) return readFields(tx, tenantId, includeRetired);
  return planTechnicalAliases(fields).filter(field => includeRetired || !field.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export async function readClosingFields(tx: Tx, tenantId: string) { return (await readFields(tx, tenantId)).filter(isClosedWonField); }
export async function readClosingFieldsForDisplay(tx: Tx, tenantId: string) { return (await readFieldsForDisplay(tx, tenantId)).filter(isClosedWonField); }
export async function validateValues(tx: Tx, tenantId: string, dealId: string, fields: ClosingField[], values: ClosingValues) {
  const errors: Record<string, string> = {};
  for (const field of fields.filter(f => f.active)) {
    const value = values[field.id];
    const error = closingValueError(field, value);
    if (error) errors[field.id] = error;
    else if (field.type === 'File Upload' && value) {
      const file = await tx.recordFile.findFirst({ where: { id: String(value), tenantId, dealId } });
      if (!file?.objectKey || file.size <= 0 || file.size > CLOSING_FILE_MAX_BYTES) errors[field.id] = 'Upload a file to this Deal successfully before saving.';
    }
  }
  return errors;
}
/** Validate persisted or projected evidence without initializing fields or writing data. */
export async function validateClosingRequirements(tx: Tx, tenantId: string, deal: { id: string; stage: { name: string }; closingValues: Prisma.JsonValue }, fields: ClosingField[]) {
  if (deal.stage.name.trim().toLowerCase() !== 'qualified') throw new ValidationError('Deal must be Qualified before completing Closed Won requirements.');
  const values = deal.closingValues as ClosingValues;
  const errors = await validateValues(tx, tenantId, deal.id, fields.filter(field => field.required), values);
  if (Object.keys(errors).length) throw new ValidationError(`Complete all required Closed Won requirements before closing this Deal. ${Object.values(errors).join(' ')}`);
  return values;
}
export async function closingEvidence(tx: Tx, tenantId: string, deal: { id: string; stage: { name: string }; closingValues: Prisma.JsonValue }, actorId: string) {
  const fields = (await readClosingFields(tx, tenantId)).filter(field => field.active);
  const values = await validateClosingRequirements(tx, tenantId, deal, fields);
  const files = await tx.recordFile.findMany({ where: { tenantId, dealId: deal.id, id: { in: fields.filter(f => f.type === 'File Upload').map(f => values[f.id]).filter((v): v is string => typeof v === 'string' && !!v) } }, select: { id: true, name: true, type: true, size: true, objectKey: true, uploadedAt: true } });
  return JSON.parse(JSON.stringify({ fields, values: Object.fromEntries(fields.map(f => [f.id, values[f.id] ?? null])), files, closedAt: new Date().toISOString(), closedById: actorId })) as Prisma.InputJsonValue;
}
