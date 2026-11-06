import prisma from '../../../config/database.config';
import { assertCrmRecordMutation, crmActor } from '../access/crm-record-access.service';
import { salesTransaction, validateSalesOwner } from '../leads/lead-automation.service';
import { AppError } from '../../../shared/errors/app-error';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { moveDealStage } from './deals.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { BulkArchiveDto, BulkReassignDto, BulkStageChangeDto } from './deals.dto';
import { fireDealUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges } from '../record-updates';
import { refreshDealClassification } from '../customer-classification.service';

export interface BulkOperationResult {
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}

/**
 * Archive multiple deals in a single operation.
 * Each deal is verified for tenant ownership; non-tenant deals are silently skipped.
 * An audit log entry is written for each successful archive.
 */
export async function bulkArchive(
  tenantId: string,
  userId: string,
  dto: BulkArchiveDto,
): Promise<BulkOperationResult> {
  await authorizeBatch(dto.dealIds, 'archive');
  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };
  let authorizationDenial: AppError | undefined;

  for (const dealId of dto.dealIds) {
    try {
      const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId } });
      if (!deal) {
        result.failed += 1;
        result.errors.push({ id: dealId, reason: 'Not found' });
        continue;
      }

      // SEC: tenantId in where clause closes the TOCTOU gap between findFirst and update
      await salesTransaction(async tx => {
        await tx.deal.update({
          where: { id: dealId, tenantId },
          data: { isArchived: true, archiveReason: dto.archiveReason ?? null },
        });
        await refreshDealClassification(tx, tenantId, dealId, userId);
      });

      await writeAuditLog({
        tenantId,
        userId,
        action: 'deal.archived',
        entityType: 'Deal',
        entityId: dealId,
        after: { isArchived: true, archiveReason: dto.archiveReason, bulk: true },
      });

      result.succeeded += 1;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 403) authorizationDenial = error;
      result.failed += 1;
      result.errors.push({ id: dealId, reason: error instanceof AppError ? error.message : 'Internal error' });
    }
  }

  return finish(result, authorizationDenial);
}

/**
 * Reassign multiple deals to a new user.
 * The target user must belong to the same tenant (returns 400 otherwise).
 * Each deal is verified for tenant ownership; non-tenant deals are silently skipped.
 * An audit log entry is written for each successful reassignment.
 */
export async function bulkReassign(
  tenantId: string,
  userId: string,
  dto: BulkReassignDto,
): Promise<BulkOperationResult> {
  await authorizeBatch(dto.dealIds, 'edit', { assignedUserId: dto.assignedUserId });
  // Verify target user belongs to tenant
  const targetUser = await prisma.user.findFirst({
    where: { id: dto.assignedUserId, tenantId },
  });
  if (!targetUser) {
    throw new ValidationError('Target user not found in tenant');
  }

  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };
  let authorizationDenial: AppError | undefined;

  for (const dealId of dto.dealIds) {
    try {
      const saved = await salesTransaction(async tx => {
      const deal = await tx.deal.findFirst({ where: { id: dealId, tenantId } });
      if (!deal) {
        return false;
      }
      await assertCrmRecordMutation(tx, 'deals', dealId, 'edit', { assignedUserId: dto.assignedUserId });
      if (crmActor.getStore()) await validateSalesOwner(tx, tenantId, dto.assignedUserId, ['deals']);
      const previousAssignee = deal.assignedUserId;
      if (previousAssignee === dto.assignedUserId) {
        return true;
      }
      // SEC: tenantId in where clause closes the TOCTOU gap between findFirst and update
      const updated = await tx.deal.update({
        where: { id: dealId, tenantId },
        data: { assignedUserId: dto.assignedUserId },
      });

      await writeAuditLog({
        tenantId,
        userId,
        action: 'deal.reassigned',
        entityType: 'Deal',
        entityId: dealId,
        occurredAt: new Date(),
        before: { assignedUserId: previousAssignee },
        after: { assignedUserId: dto.assignedUserId, bulk: true },
      });
      const changes = recordChanges(deal, updated);
      if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId: userId, record: updated, changedFields: changes.changedFields, changes });
      return true;
      });
      if (saved) result.succeeded += 1;
      else { result.failed += 1; result.errors.push({ id: dealId, reason: 'Not found' }); }
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 403) authorizationDenial = error;
      result.failed += 1;
      result.errors.push({ id: dealId, reason: error instanceof AppError ? error.message : 'Internal error' });
    }
  }

  return finish(result, authorizationDenial);
}

/**
 * Move multiple deals to a new stage.
 * The target stage must belong to the tenant's pipeline (returns 400 otherwise).
 * Lost stage transitions require a lostReason (returns 400 if missing).
 * Deals missing required stage fields are skipped and included in error summary.
 * A DealStageHistory record with time-in-previous-stage is created for each deal.
 * An audit log entry is written for each successful stage change.
 */
export async function bulkStageChange(
  tenantId: string,
  userId: string,
  dto: BulkStageChangeDto,
): Promise<BulkOperationResult> {
  await authorizeBatch(dto.dealIds, 'edit');
  // Verify target stage belongs to tenant
  const targetStage = await prisma.stage.findFirst({
    where: { id: dto.stageId, tenantId },
  });
  if (!targetStage) {
    throw new ValidationError('Target stage not found in tenant');
  }
  if (targetStage.isWon) throw new ValidationError('Confirm each Closed Deal individually with its supporting evidence.');

  // Lost stage requires lostReason
  if (targetStage.isLost && !dto.lostReason) {
    throw new ValidationError('Lost reason required for lost stage transitions');
  }

  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };
  let authorizationDenial: AppError | undefined;

  for (const dealId of dto.dealIds) {
    try {
      const deal = await prisma.deal.findFirst({
        where: { id: dealId, tenantId },
        include: { stage: true },
      });
      if (!deal) {
        result.failed += 1;
        result.errors.push({ id: dealId, reason: 'Not found' });
        continue;
      }

      // Check required fields for target stage
      if (targetStage.requiredFields && targetStage.requiredFields.length > 0) {
        const missingFields: string[] = [];
        for (const field of targetStage.requiredFields) {
          const value = (deal as Record<string, unknown>)[field];
          if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
            missingFields.push(field);
          }
        }
        if (missingFields.length > 0) {
          result.failed += 1;
          result.errors.push({ id: dealId, reason: `Missing required fields: ${missingFields.join(', ')}` });
          continue;
        }
      }

      // Reuse the governed transition: transactional history, pipeline consistency,
      // stage requirements, audit, notifications, and the existing Workflow events.
      if (deal.stageId === dto.stageId && crmActor.getStore()) await salesTransaction(tx => assertCrmRecordMutation(tx, 'deals', dealId));
      if (deal.stageId !== dto.stageId) {
        await moveDealStage(dealId, tenantId, userId, {
          stageId: dto.stageId,
          note: dto.note,
          lostReason: dto.lostReason,
        });
      }
      result.succeeded += 1;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 403) authorizationDenial = error;
      result.failed += 1;
      result.errors.push({ id: dealId, reason: error instanceof AppError ? error.message : 'Internal error' });
    }
  }

  return finish(result, authorizationDenial);
}

async function authorizeBatch(ids: string[], operation: 'edit' | 'archive', data = {}) {
  if (!crmActor.getStore()) return;
  await salesTransaction(async tx => {
    for (const id of [...new Set(ids)].sort()) await assertCrmRecordMutation(tx, 'deals', id, operation, data);
  });
}
function finish(result: BulkOperationResult, authorizationDenial?: AppError) {
  if (!result.succeeded && authorizationDenial) throw authorizationDenial;
  if (!result.succeeded && result.errors.some(error => /assigned to you|cannot reassign/.test(error.reason))) {
    throw new AppError('You can only edit Deals assigned to you.', 403, 'CRM_ASSIGNMENT_REQUIRED');
  }
  return result;
}
