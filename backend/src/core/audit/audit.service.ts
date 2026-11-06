import prisma from '../../config/database.config';
import type { Prisma } from '@prisma/client';
import { salesContext } from '../../modules/crm/leads/sales-context';

export interface AuditParams {
  tenantId:   string;
  userId:     string;
  action:     string;           // e.g. 'contact.created', 'deal.stage_changed'
  entityType: string;           // e.g. 'Contact', 'Deal'
  entityId?:  string;
  before?:    Record<string, unknown>;   // state before the change
  after?:     Record<string, unknown>;   // state after the change
  metadata?:  Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  severity?:  'INFO' | 'WARNING' | 'CRITICAL';
  occurredAt?: Date;
}

/**
 * Write a single audit log entry.
 * CRM transaction audit entries commit with their source and propagate failures.
 * Standalone audit callers retain best-effort logging.
 */
export async function writeAuditLog(params: AuditParams, db?: Prisma.TransactionClient): Promise<void> {
  const transaction = db ?? salesContext.getStore();
  const changeset =
    params.before || params.after
      ? { before: params.before ?? null, after: params.after ?? null }
      : undefined;

  try {
    await (transaction ?? prisma).auditLog.create({
      data: {
        tenantId:   params.tenantId,
        userId:     params.userId,
        action:     params.action,
        entityType: params.entityType,
        entityId:   params.entityId,
        changeset:  changeset ? (changeset as object) : undefined,
        metadata:   params.metadata ? (params.metadata as object) : undefined,
        ipAddress:  params.ipAddress,
        userAgent:  params.userAgent,
        sessionId:  params.sessionId,
        severity:   params.severity ?? 'INFO',
        createdAt:  params.occurredAt,
      },
    });
  } catch (err) {
    if (transaction) throw err;
    // Log internally but never surface to caller
    console.error('[AuditLog] Failed to write audit entry:', err);
  }
}

/**
 * Convenience wrapper — builds changeset from old/new objects automatically.
 * Only includes fields that actually changed.
 */
export function buildChangeset(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter:  Record<string, unknown> = {};

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key]  = after[key];
    }
  }

  return { before: changedBefore, after: changedAfter };
}
