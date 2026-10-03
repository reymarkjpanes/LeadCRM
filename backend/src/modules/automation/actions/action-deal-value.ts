import { salesTransaction } from '../../crm/leads/lead-automation.service';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import { fireDealUpdated } from '../triggers/triggers.service';
import { recordChanges } from '../../crm/record-updates';

/** An explicit Custom Fields update; the ordinary product price editor remains governed. */
export async function updateWorkflowDealValue(id: string, tenantId: string, actorId: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 999_999_999_999) throw new ValidationError('Enter a valid Deal Value.');
  const result = await salesTransaction(async tx => {
    const before = await tx.deal.findFirst({ where: { id, tenantId, isArchived: false }, include: { stage: true } });
    if (!before) throw new NotFoundError('Deal');
    if (before.stage.isWon || before.hasEverBeenWon || before.closingSnapshot) throw new ValidationError('A won Deal value is preserved. Create a new Deal for a new opportunity.');
    if (before.value === value) return { before, after: before };
    const after = await tx.deal.update({ where: { id, tenantId }, data: { value } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, entityType: 'Deal', entityId: id, action: 'deal.updated',
      changeset: { before: { value: before.value }, after: { value } }, metadata: { source: 'workflow_custom_fields' } } });
    return { before, after };
  });
  const changes = recordChanges(result.before, result.after);
  if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId, record: result.after, changedFields: changes.changedFields, changes });
}
