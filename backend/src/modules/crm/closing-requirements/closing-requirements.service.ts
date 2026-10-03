import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ClosingFieldInputSchema, ClosingValuesPatchSchema, type ClosingField, type ClosingValues, type ClosingRequirementsState } from '@leadcrm/shared';
import { salesTransaction } from '../leads/lead-automation.service';
import { readFields, validateValues } from './closing-requirements.repository';
import { moveDealStage } from '../deals/deals.repository';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { fireDealStageChanged, fireDealUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges } from '../record-updates';
import { isDeepStrictEqual } from 'node:util';

export const listFields = (tenantId: string) => salesTransaction(tx => readFields(tx, tenantId));
export async function saveField(tenantId: string, actorId: string, input: unknown, id?: string) {
  return salesTransaction(async tx => {
    const fields = await readFields(tx, tenantId);
    const previous = fields.find(f => f.id === id);
    if (id && !previous) throw new NotFoundError('Closing field');
    const patch = input as Record<string, unknown>;
    let definitionInput = input;
    if (previous && Object.keys(patch).length === 1 && patch.active === false) {
      const { id: _id, version: _version, ...definition } = previous;
      definitionInput = { ...definition, active: false };
    }
    const field = ClosingFieldInputSchema.parse(definitionInput);
    if (!id && fields.length >= 100) throw new ValidationError('Maximum 100 closing fields.');
    if (fields.some(f => f.id !== id && f.name.toLowerCase() === field.name.toLowerCase())) throw new ValidationError('Field names must be unique.');
    // Keep IDs and types stable so existing values cannot change meaning after an edit.
    if (previous && previous.type !== field.type) throw new ValidationError('Field type cannot be changed. Add a new field instead.');
    const saved: ClosingField = { ...field, id: id ?? randomUUID(), version: (previous?.version ?? 0) + 1 };
    const definition = saved as unknown as Prisma.InputJsonValue;
    if (previous) await tx.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: saved.id } }, data: { definition } });
    else await tx.closingFieldDefinition.create({ data: { tenantId, id: saved.id, definition } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: previous ? 'closing_field.updated' : 'closing_field.created', entityType: 'ClosingField', entityId: saved.id, changeset: { before: previous ?? null, after: saved } as unknown as Prisma.InputJsonValue } });
    return saved;
  });
}

async function readState(tx: Prisma.TransactionClient, tenantId: string, dealId: string): Promise<ClosingRequirementsState> {
  const deal = await tx.deal.findFirst({ where: { id: dealId, tenantId, isArchived: false, deletedAt: null }, include: { stage: true } });
  if (!deal) throw new NotFoundError('Deal');
  const snapshot = deal.closingSnapshot as { fields?: ClosingField[]; values?: ClosingValues } | null;
  const locked = deal.stage.isWon || deal.stage.isLost || !!snapshot;
  const fields = snapshot?.fields ?? (locked ? [] : await readFields(tx, tenantId));
  const values = snapshot?.values ?? deal.closingValues as ClosingValues;
  const files = await tx.recordFile.findMany({ where: { tenantId, dealId }, select: { id: true, name: true, size: true, type: true } });
  return { fields, values, locked, closedAt: deal.wonConfirmedAt?.toISOString(), errors: locked ? {} : await validateValues(tx, tenantId, dealId, fields, values),
    files: files.map(file => ({ ...file, url: `/api/proxy/crm/deals/${encodeURIComponent(dealId)}/files/${file.id}/download` })) };
}
export const getRequirements = (tenantId: string, dealId: string) => salesTransaction(tx => readState(tx, tenantId, dealId));

export async function saveValues(tenantId: string, actorId: string, dealId: string, input: unknown) {
  const patch = ClosingValuesPatchSchema.parse(input);
  const result = await salesTransaction(async tx => {
    const deal = await tx.deal.findFirst({ where: { id: dealId, tenantId, isArchived: false, deletedAt: null }, include: { stage: true } });
    if (!deal) throw new NotFoundError('Deal');
    if (deal.stage.isWon || deal.stage.isLost || deal.closingSnapshot) throw new ValidationError('Closed Deal evidence is preserved and cannot be edited.');
    const fields = await readFields(tx, tenantId);
    if (Object.keys(patch.values).some(id => !fields.some(f => f.id === id && f.active))) throw new ValidationError('Choose an active closing field.');
    const normalized = Object.fromEntries(Object.entries(patch.values).map(([id, value]) => [id, typeof value === 'string' ? value.trim() : value]));
    const previousValues = deal.closingValues as ClosingValues;
    const changed = Object.keys(normalized).filter(id => !isDeepStrictEqual(previousValues[id], normalized[id]));
    if (!changed.length) return { state: await readState(tx, tenantId, dealId), transition: null, before: deal, updated: deal };
    const values: ClosingValues = { ...deal.closingValues as ClosingValues, ...normalized };
    const errors = await validateValues(tx, tenantId, dealId, fields, values);
    const invalid = changed.filter(id => errors[id]);
    if (invalid.length) throw new ValidationError(invalid.map(id => errors[id]).join(' '));
    const updated = await tx.deal.update({ where: { id: dealId, tenantId }, data: { closingValues: values } });
    await tx.activity.create({ data: { tenantId, dealId, createdById: actorId, type: 'note', title: 'Closed Won requirements updated', description: fields.filter(f => changed.includes(f.id)).map(f => f.name).join(', '), metadata: { source: 'closing_requirements', fieldIds: changed } } });
    let transition: Awaited<ReturnType<typeof moveDealStage>> = null;
    const missingRequired = fields.some(field => field.active && field.required && errors[field.id]);
    if (deal.stage.name.trim().toLowerCase() === 'qualified' && !missingRequired) {
      const wonStages = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, isWon: true, isLost: false } });
      if (wonStages.length !== 1) throw new ValidationError('Configure exactly one Closed Won stage in this pipeline.');
      transition = await moveDealStage(dealId, tenantId, wonStages[0].id, actorId, undefined, undefined, undefined, undefined, tx);
      if (transition?.stageHistory) await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'deal.stage_changed', entityType: 'Deal', entityId: dealId, changeset: { before: { stageId: deal.stageId }, after: { stageId: wonStages[0].id } }, metadata: { source: 'closing_requirements' } } });
    }
    return { state: await readState(tx, tenantId, dealId), transition, before: deal, updated: transition?.deal ?? updated };
  });
  if (result.transition?.stageHistory) {
    const { deal, stageHistory } = result.transition;
    await fireDealStageChanged({ tenantId, actorId, eventId: stageHistory.id, deal, newStageId: deal.stageId, newStageName: deal.stage.name, isWon: true, isLost: false, prevStageId: stageHistory.previousStageId ?? undefined });
  }
  const changes = recordChanges(result.before, result.updated);
  if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId, record: result.updated,
    eventId: result.transition?.stageHistory?.id, changedFields: changes.changedFields, changes });
  return result.state;
}
