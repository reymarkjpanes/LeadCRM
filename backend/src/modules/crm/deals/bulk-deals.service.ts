import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { moveDealStage } from './deals.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { BulkArchiveDto, BulkReassignDto, BulkStageChangeDto } from './deals.dto';
import { fireDealUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges } from '../record-updates';

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
  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };

  for (const dealId of dto.dealIds) {
    try {
      const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId } });
      if (!deal) {
        result.failed += 1;
        result.errors.push({ id: dealId, reason: 'Not found' });
        continue;
      }

      // SEC: tenantId in where clause closes the TOCTOU gap between findFirst and update
      await prisma.deal.update({
        where: { id: dealId, tenantId },
        data: { isArchived: true, archiveReason: dto.archiveReason ?? null },
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
    } catch {
      result.failed += 1;
      result.errors.push({ id: dealId, reason: 'Internal error' });
    }
  }

  return result;
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
  // Verify target user belongs to tenant
  const targetUser = await prisma.user.findFirst({
    where: { id: dto.assignedUserId, tenantId },
  });
  if (!targetUser) {
    throw new ValidationError('Target user not found in tenant');
  }

  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };

  for (const dealId of dto.dealIds) {
    try {
      const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId } });
      if (!deal) {
        result.failed += 1;
        result.errors.push({ id: dealId, reason: 'Not found' });
        continue;
      }

      const previousAssignee = deal.assignedUserId;
      if (previousAssignee === dto.assignedUserId) {
        result.succeeded += 1;
        continue;
      }
      // SEC: tenantId in where clause closes the TOCTOU gap between findFirst and update
      const updated = await prisma.deal.update({
        where: { id: dealId, tenantId },
        data: { assignedUserId: dto.assignedUserId },
      });

      await writeAuditLog({
        tenantId,
        userId,
        action: 'deal.reassigned',
        entityType: 'Deal',
        entityId: dealId,
        before: { assignedUserId: previousAssignee },
        after: { assignedUserId: dto.assignedUserId, bulk: true },
      });
      const changes = recordChanges(deal, updated);
      if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId: userId, record: updated, changedFields: changes.changedFields, changes });

      result.succeeded += 1;
    } catch {
      result.failed += 1;
      result.errors.push({ id: dealId, reason: 'Internal error' });
    }
  }

  return result;
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
  // Verify target stage belongs to tenant
  const targetStage = await prisma.stage.findFirst({
    where: { id: dto.stageId, tenantId },
  });
  if (!targetStage) {
    throw new ValidationError('Target stage not found in tenant');
  }
  if (targetStage.isWon) throw new ValidationError('Confirm each Closed Won Deal individually with its supporting evidence.');

  // Lost stage requires lostReason
  if (targetStage.isLost && !dto.lostReason) {
    throw new ValidationError('Lost reason required for lost stage transitions');
  }

  const result: BulkOperationResult = { succeeded: 0, failed: 0, errors: [] };

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
      if (deal.stageId !== dto.stageId) {
        await moveDealStage(dealId, tenantId, userId, {
          stageId: dto.stageId,
          note: dto.note,
          lostReason: dto.lostReason,
        });
      }
      result.succeeded += 1;
    } catch {
      result.failed += 1;
      result.errors.push({ id: dealId, reason: 'Internal error' });
    }
  }

  return result;
}
