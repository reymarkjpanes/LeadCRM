import type { Prisma } from '@prisma/client';
import type { DeactivationImpact } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { salesTransaction, validateSalesOwner } from '../../crm/leads/lead-automation.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/http-error';

type Tx = Prisma.TransactionClient;
export function ownershipWhere(tenantId: string, userId: string) {
  const active = { tenantId, assignedUserId: userId, isArchived: false, deletedAt: null };
  return { leads: { ...active, convertedAt: null }, contacts: active, accounts: active, deals: active,
    tasks: { tenantId, assignedUserId: userId, isArchived: false, status: { notIn: ['completed', 'cancelled'] } } };
}
export async function ownershipImpact(tx: Tx, tenantId: string, userId: string): Promise<DeactivationImpact> {
  const where = ownershipWhere(tenantId, userId);
  const [leads, contacts, accounts, deals, tasks] = await Promise.all([
    tx.lead.count({ where: where.leads }), tx.contact.count({ where: where.contacts }),
    tx.account.count({ where: where.accounts }), tx.deal.count({ where: where.deals }),
    tx.task.count({ where: where.tasks }),
  ]);
  return { userId, counts: { leads, contacts, accounts, deals, tasks }, total: leads + contacts + accounts + deals + tasks };
}
async function requireTarget(tx: Tx, tenantId: string, id: string, actorId: string) {
  if (id === actorId) throw new ForbiddenError('Cannot deactivate your own account');
  const target = await tx.user.findFirst({ where: { tenantId, id }, select: { id: true, status: true, role: true, firstName: true, lastName: true } });
  if (!target) throw new NotFoundError('User');
  if (target.status !== 'ACTIVE') throw new ConflictError('This user is no longer active. Refresh Team Management.');
  if (target.role === 'Client Admin' && await tx.user.count({ where: { tenantId, role: 'Client Admin', status: 'ACTIVE' } }) <= 1) {
    throw new ConflictError('At least one active Client Admin must remain.');
  }
  return target;
}
export async function deactivationImpact(id: string, tenantId: string, actorId: string) {
  await requireTarget(prisma, tenantId, id, actorId);
  return ownershipImpact(prisma, tenantId, id);
}
export async function assertNoOwnership(tx: Tx, tenantId: string, id: string) {
  if ((await ownershipImpact(tx, tenantId, id)).total) throw new ConflictError('This user has assigned CRM records or unfinished tasks. Reassign them before deactivation or archiving.');
}

/** Administrative transfer intentionally writes Activities and AuditLog, not ordinary
 * CRM update events. That prevents bulk email/SMS Workflow execution on deactivation.
 */
export async function deactivateUser(id: string, tenantId: string, actorId: string, replacementAgentId?: string | null) {
  const result = await salesTransaction(async tx => {
    const actor = await tx.user.findFirst({ where: { tenantId, id: actorId, status: 'ACTIVE', role: 'Client Admin' }, select: { id: true } });
    if (!actor) throw new ForbiddenError('Only Client Admin can transfer CRM ownership during deactivation.');
    const target = await requireTarget(tx, tenantId, id, actorId);
    const impact = await ownershipImpact(tx, tenantId, id);
    if (replacementAgentId === id) throw new ConflictError('Choose another active Assigned Agent.');
    if (impact.total && !replacementAgentId) throw new ConflictError('Choose an Assigned Agent before deactivating this user.');
    if (replacementAgentId) {
      const replacement = await validateSalesOwner(tx, tenantId, replacementAgentId)
        .catch(() => { throw new ConflictError('The selected Assigned Agent is no longer available. Choose another agent.'); });
      if (impact.counts.tasks && replacement.role !== 'Client Admin' &&
          !replacement.userRoles.some(link => link.role.permissions.some(permission => permission.module === 'tasks' && permission.canView))) {
        throw new ConflictError('Choose an Assigned Agent with Tasks View permission to receive the unfinished tasks.');
      }
    }
    const where = ownershipWhere(tenantId, id);
    const transfer = async (kind: 'lead' | 'contact' | 'account' | 'deal', filter: typeof where.contacts) => {
      if (!replacementAgentId) return;
      // IDs only, bounded keyset batches; all batches remain in the same transaction.
      const model = tx[kind] as typeof tx.lead;
      let cursor: string | undefined;
      for (;;) {
        const rows = await model.findMany({ where: { ...filter, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 500 });
        if (!rows.length) break;
        const ids = rows.map(row => row.id);
        await model.updateMany({ where: { ...filter, id: { in: ids } }, data: { assignedUserId: replacementAgentId } });
        // Deal ownerId remains a live compatibility alias. Preserve other historical actors.
        if (kind === 'deal') await tx.deal.updateMany({ where: { tenantId, id: { in: ids } }, data: { ownerId: replacementAgentId } });
        await tx.activity.createMany({ data: ids.map(recordId => ({ tenantId, createdById: actorId,
          [`${kind}Id`]: recordId, type: 'assignment', title: 'Assigned Agent changed',
          description: `Ownership transferred because ${target.firstName} ${target.lastName} was deactivated.`,
          metadata: { previousAssignedUserId: id, newAssignedUserId: replacementAgentId, reason: 'user_deactivation' },
        })) });
        cursor = ids[ids.length - 1];
      }
    };
    await transfer('lead', where.leads);
    await transfer('contact', where.contacts);
    await transfer('account', where.accounts);
    await transfer('deal', where.deals);
    if (replacementAgentId) {
      let cursor: string | undefined;
      for (;;) {
        const rows = await tx.task.findMany({ where: { ...where.tasks, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 500 });
        if (!rows.length) break;
        const ids = rows.map(row => row.id);
        await tx.task.updateMany({ where: { ...where.tasks, id: { in: ids } }, data: { assignedUserId: replacementAgentId, assignedById: actorId } });
        await tx.activity.createMany({ data: ids.map(taskId => ({ tenantId, createdById: actorId, taskId,
          type: 'assignment', title: 'Task assignee changed',
          description: `Task reassigned because ${target.firstName} ${target.lastName} was deactivated.`,
          metadata: { previousAssignedUserId: id, newAssignedUserId: replacementAgentId, reason: 'user_deactivation' },
        })) });
        cursor = ids[ids.length - 1];
      }
    }
    await assertNoOwnership(tx, tenantId, id);
    await tx.user.update({ where: { tenantId, id }, data: { status: 'INACTIVE' } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'user.deactivated_with_reassignment', entityType: 'User', entityId: id,
      metadata: { replacementAgentId: replacementAgentId ?? null, ...impact.counts } } });
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return impact;
  });
  return result;
}
