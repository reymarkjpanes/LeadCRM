import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { WorkflowAssignmentTargetSchema, workflowAssignmentTarget, type WorkflowAction, type WorkflowAssignmentPurpose, type WorkflowAssignmentTarget, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { assignmentCandidates, assignmentPool, assignmentWorkloads } from './workflow-assignment.repository';
import { liveReservations, memberAvailable, stickyAssignmentKey } from './workflow-assignment-policy';

export function assignmentPurpose(action: WorkflowAction): WorkflowAssignmentPurpose {
  return action.type === 'create_task' ? 'task_assignee' : 'crm_owner';
}
export function parseAssignment(action: WorkflowAction): WorkflowAssignmentTarget {
  const parsed = WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action));
  if (!parsed.success) throw new ValidationError('Choose a valid assignment target: a user, role or group with a supported assignment method.');
  if (action.type === 'assign_owner' && parsed.data.type === 'record_owner') throw new ValidationError('Assign Agent requires a specific user, role or group.');
  return parsed.data;
}
export type AssignmentRequest = {
  tenantId: string; target: WorkflowAssignmentTarget; purpose: WorkflowAssignmentPurpose;
  recordOwnerId?: string; workflowId?: string; actionIndex?: number; dryRun?: boolean;
  entity?: WorkflowEntity; entityId?: string;
  previewLoads?: Map<string, number>;
};
async function candidates(client: Prisma.TransactionClient, request: AssignmentRequest) {
  const { tenantId, target, purpose } = request;
  const users = await assignmentCandidates(client, tenantId, purpose);
  if (target.type === 'user' || target.type === 'record_owner') {
    const id = target.type === 'user' ? target.id : request.recordOwnerId;
    if (!id) throw new ValidationError('Assign an agent to the triggering record or choose an explicit assignment target.');
    const user = users.find(user => user.id === id);
    if (!user) throw new ValidationError(purpose === 'crm_owner'
      ? 'Choose an active sales agent with Lead and Deal permissions in this workspace.'
      : 'The selected task assignee is unavailable, inactive or lacks Tasks access in this workspace.');
    return { users: [user], targetName: `${user.firstName} ${user.lastName}` };
  }
  const pool = await assignmentPool(client, tenantId, target);
  if (!pool) throw new ValidationError(`The selected ${target.type} is no longer available. Choose another assignment target.`);
  const eligible = users.filter(user => user.role !== 'Client Admin' && pool.memberIds.includes(user.id));
  const configured = [...(target.availability?.members ?? []), ...(target.capacity?.members ?? [])];
  // Former members may remain in saved settings; foreign or missing users may never be referenced.
  if (configured.length) {
    const ids = [...new Set(configured.map(row => row.userId))];
    if (await client.user.count({ where: { tenantId, id: { in: ids } } }) !== ids.length) throw new ValidationError('Assignment member settings reference an unavailable workspace user.');
  }
  if (!eligible.length) throw new ValidationError(`${pool.name} has no active members eligible for ${purpose === 'crm_owner' ? 'CRM ownership' : 'task assignment'}.`);
  return { users: eligible, targetName: pool.name };
}

export async function validateAssignment(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context?: Record<string, unknown>, incomplete = false) {
  const raw = workflowAssignmentTarget(action);
  if (incomplete && raw === undefined) return;
  // A draft can retain an unselected target, but never malformed IDs or unsupported strategies.
  if (incomplete && raw && typeof raw === 'object' && 'id' in raw && raw.id === '') {
    const check = WorkflowAssignmentTargetSchema.safeParse({ ...raw, id: '00000000-0000-4000-8000-000000000000' });
    if (check.success && check.data.type !== 'record_owner') return;
  }
  const target = parseAssignment(action);
  if (target.type === 'record_owner' && !context) return;
  await candidates(prisma, { tenantId, target, purpose: assignmentPurpose(action), recordOwnerId: context?.[`${entity}.assignedUserId`] as string | undefined });
}

/** Reserve one turn per workflow/action/pool. Dry-runs only read the cursor. */
export async function resolveWorkflowAssignee(request: AssignmentRequest) {
  const resolve = async (client: Prisma.TransactionClient) => {
    const { users, targetName } = await candidates(client, request);
    const target = request.target;
    let user = users[0];
    let reason = 'Direct assignment';
    let workload: number | undefined, capacityLimit: number | undefined;
    let reservation: { key: string; token: string } | undefined, stickyKey: string | undefined;
    let stickyLease: { key: string; token: string } | undefined;
    let candidateCount = users.length;
    if (target.type === 'role' || target.type === 'group') {
      if (!request.workflowId || !Number.isInteger(request.actionIndex) || request.actionIndex! < 0) throw new ValidationError('Workflow assignment context is missing.');
      const key = { tenantId: request.tenantId, module: 'workflow-assignment', key: `${request.workflowId}:${request.actionIndex}:${target.type}:${target.id}` };
      const cursor = await client.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
      const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
      let available = target.availability ? users.filter(candidate => memberAvailable(candidate.id, target.availability!)) : users;
      if (!available.length) throw new ValidationError(`${targetName} has no eligible members available during the configured shifts.`);
      const method = target.strategy === 'sticky' ? target.sticky?.fallback ?? 'round_robin' : target.strategy;
      const needsWorkload = !!target.capacity || method === 'least_workload' || method === 'capacity';
      const metric = request.purpose === 'task_assignee' ? 'task' : request.entity;
      if (needsWorkload && !metric) throw new ValidationError('The triggering record type is required for workload assignment.');
      const counts = needsWorkload ? await assignmentWorkloads(client, request.tenantId, available.map(candidate => candidate.id), request.purpose, request.entity, request.entityId) : new Map<string, number>();
      const reservationRows = needsWorkload ? await client.tenantPreference.findMany({ where: { tenantId: request.tenantId, module: 'workflow-assignment-pending', key: { in: available.map(candidate => `${metric}:${candidate.id}`) } } }) : [];
      const pending = new Map(reservationRows.map(row => [row.key, liveReservations(row.value, Date.now())]));
      const load = (id: string) => (counts.get(id) ?? 0) + (request.previewLoads?.get(`${metric}:${id}`) ?? 0) + (pending.get(`${metric}:${id}`) ?? []).filter(row => !request.entityId || request.purpose === 'task_assignee' || row.entityId !== request.entityId).length;
      const limit = (id: string) => target.capacity?.members.find(row => row.userId === id)?.limit ?? target.capacity?.maxPerMember;
      available = available.filter(candidate => limit(candidate.id) === undefined || load(candidate.id) < limit(candidate.id)!);
      if (!available.length) throw new ValidationError(`${targetName} has no eligible members below their configured capacity. Complete or reassign work, or adjust the limits.`);
      candidateCount = available.length;
      let previousId: string | undefined;
      if (target.strategy === 'sticky') {
        if (!request.entity || !request.entityId) throw new ValidationError('A triggering record is required for sticky assignment.');
        stickyKey = stickyAssignmentKey(request.workflowId!, request.actionIndex!, target.type, target.id, request.entity, request.entityId);
        const previous = await client.tenantPreference.findUnique({ where: { tenantId_module_key: { tenantId: request.tenantId, module: 'workflow-assignment-sticky', key: stickyKey } } });
        const inflight = await client.tenantPreference.findUnique({ where: { tenantId_module_key: { tenantId: request.tenantId, module: 'workflow-assignment-sticky-pending', key: stickyKey } } });
        const lease = inflight?.value;
        const pendingUser = lease && typeof lease === 'object' && !Array.isArray(lease) && typeof lease.expiresAt === 'number' && lease.expiresAt > Date.now() && typeof lease.userId === 'string' ? lease.userId : undefined;
        previousId = typeof previous?.value === 'string' ? previous.value : pendingUser ?? (target.sticky?.preferCurrentOwner !== false ? request.recordOwnerId : undefined);
      }
      const previous = available.find(candidate => candidate.id === previousId);
      if (previous) { user = previous; reason = 'Previous assignee retained for this record'; }
      else {
        if (method === 'least_workload' || method === 'capacity') {
          const minimum = Math.min(...available.map(candidate => load(candidate.id)));
          available = available.filter(candidate => load(candidate.id) === minimum);
        }
        user = method === 'random' && !request.dryRun ? available[randomInt(available.length)] : available.find(candidate => candidate.id > lastId) ?? available[0];
        reason = method === 'random' ? request.dryRun ? 'Random sample only; a live execution draws again' : 'Randomly selected from eligible members'
          : method === 'least_workload' ? 'Lowest active workload; ties rotate'
          : method === 'capacity' ? 'Lowest active workload below capacity; ties rotate'
          : method === 'availability' ? 'Available during configured shift; eligible members rotate' : 'Next eligible member in rotation';
        if (target.strategy === 'sticky') reason = `Previous assignee unavailable or unset. ${reason}`;
      }
      if (needsWorkload) {
        workload = load(user.id); capacityLimit = limit(user.id);
        if (!request.dryRun) {
          const pendingKey = `${metric}:${user.id}`;
          const token = randomUUID();
          // A short durable lease bridges the reservation and the existing domain-service commit.
          // Concurrent workflow actions include these leases in their workload, across workflows/pools.
          const value = [...(pending.get(pendingKey) ?? []), { token, expiresAt: Date.now() + 300000, ...(request.entityId ? { entityId: request.entityId } : {}) }];
          const scoped = { tenantId: request.tenantId, module: 'workflow-assignment-pending', key: pendingKey };
          await client.tenantPreference.upsert({ where: { tenantId_module_key: scoped }, create: { ...scoped, value }, update: { value } });
          reservation = { key: pendingKey, token };
        }
      }
      if (stickyKey && !request.dryRun) {
        const token = randomUUID();
        const scoped = { tenantId: request.tenantId, module: 'workflow-assignment-sticky-pending', key: stickyKey };
        const value = { userId: user.id, token, expiresAt: Date.now() + 300000 };
        await client.tenantPreference.upsert({ where: { tenantId_module_key: scoped }, create: { ...scoped, value }, update: { value } });
        stickyLease = { key: stickyKey, token };
      }
      if (!request.dryRun) await client.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: user.id }, update: { value: user.id } });
    }
    return { assignmentTargetType: target.type, ...(target.type !== 'record_owner' ? { assignmentTargetId: target.id } : {}),
      assignmentTargetName: targetName, resolvedUserId: user.id, resolvedUserName: `${user.firstName} ${user.lastName}`,
      candidateCount, strategy: target.type === 'role' || target.type === 'group' ? target.strategy : 'direct', reason,
      ...(workload !== undefined ? { workload } : {}), ...(capacityLimit !== undefined ? { capacityLimit } : {}),
      ...(reservation ? { reservation } : {}), ...(stickyKey ? { stickyKey } : {}), ...(stickyLease ? { stickyLease } : {}) };
  };
  if (request.dryRun || request.target.type === 'user' || request.target.type === 'record_owner') return resolve(prisma);
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(resolve, { isolationLevel: 'Serializable' }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
      throw error;
    }
  }
}

/** Remember only successful sticky assignments; release workload leases after the domain write. */
export async function completeWorkflowAssignment(tenantId: string, assignment: Awaited<ReturnType<typeof resolveWorkflowAssignee>>, succeeded: boolean) {
  if (!assignment.reservation && !assignment.stickyLease && !(assignment.stickyKey && succeeded)) return;
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async client => {
        if (assignment.reservation) {
          const key = { tenantId, module: 'workflow-assignment-pending', key: assignment.reservation.key };
          const row = await client.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
          if (row) await client.tenantPreference.update({ where: { tenantId_module_key: key }, data: { value: liveReservations(row.value, Date.now()).filter(item => item.token !== assignment.reservation!.token) } });
        }
        if (assignment.stickyKey && succeeded) {
          const key = { tenantId, module: 'workflow-assignment-sticky', key: assignment.stickyKey };
          await client.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: assignment.resolvedUserId }, update: { value: assignment.resolvedUserId } });
        }
        if (assignment.stickyLease) {
          const key = { tenantId, module: 'workflow-assignment-sticky-pending', key: assignment.stickyLease.key };
          const row = await client.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
          const lease = row?.value;
          if (lease && typeof lease === 'object' && !Array.isArray(lease) && lease.token === assignment.stickyLease.token) {
            await client.tenantPreference.delete({ where: { tenantId_module_key: key } });
          }
        }
      }, { isolationLevel: 'Serializable' });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
      throw error;
    }
  }
}

export function assignmentOutput(assignment: Awaited<ReturnType<typeof resolveWorkflowAssignee>>) {
  const { reservation, stickyKey, stickyLease, ...output } = assignment;
  return output;
}
