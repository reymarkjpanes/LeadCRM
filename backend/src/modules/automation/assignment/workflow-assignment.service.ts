import { lowestWorkloadRotation } from '../../crm/leads/lead-workload';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { WorkflowAssignmentTargetSchema, workflowAssignmentTarget, LEAD_WORKLOAD_WEIGHTS, normalizeCrmStatus, type WorkflowAction, type WorkflowAssignmentPurpose, type WorkflowAssignmentTarget, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { assignmentCandidates, assignmentPool, assignmentWorkloads, assignmentLeadScores } from './workflow-assignment.repository';
import { liveReservations, memberAvailable } from './workflow-assignment-policy';
import { fenceWorkflowLease } from '../workflows/workflow-lease';

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
  const users = await assignmentCandidates(client, tenantId, purpose, request.entity);
  if (target.type === 'user' || target.type === 'record_owner') {
    const id = target.type === 'user' ? target.id : request.recordOwnerId;
    if (!id) throw new ValidationError('Assign an agent to the triggering record or choose an explicit assignment target.');
    const user = users.find(user => user.id === id);
    if (!user) throw new ValidationError(purpose === 'crm_owner'
      ? 'Choose an active agent with access to the triggering CRM module in this workspace.'
      : 'The selected task assignee is unavailable, inactive or lacks Tasks access in this workspace.');
    return { users: [user], targetName: `${user.firstName} ${user.lastName}` };
  }
  const pool = await assignmentPool(client, tenantId, target, purpose);
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
  if ((target.type === 'role' || target.type === 'group') && target.strategy === 'weighted_workload' && (action.type !== 'assign_owner' || entity !== 'lead')) throw new ValidationError('Weighted workload is available for Lead owner assignment only.');
  if (target.type === 'record_owner' && !context) return;
  await candidates(prisma, { tenantId, target, purpose: assignmentPurpose(action), entity, recordOwnerId: context?.[`${entity}.assignedUserId`] as string | undefined });
}

/** Reserve one turn per workflow/action/pool. Dry-runs only read the cursor. */
export async function resolveWorkflowAssignee(request: AssignmentRequest) {
  const resolve = async (client: Prisma.TransactionClient) => {
    const { users, targetName } = await candidates(client, request);
    const target = request.target;
    let user = users[0];
    let reason = 'Direct assignment';
    let workload: number | undefined, capacityLimit: number | undefined;
    let reservation: { key: string; token: string } | undefined;
    let candidateCount = users.length;
    if (target.type === 'role' || target.type === 'group') {
      if (!request.workflowId || !Number.isInteger(request.actionIndex) || request.actionIndex! < 0) throw new ValidationError('Workflow assignment context is missing.');
      const key = { tenantId: request.tenantId, module: 'workflow-assignment', key: `${request.workflowId}:${request.actionIndex}:${target.type}:${target.id}` };
      const cursor = await client.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
      const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
      let available = target.availability ? users.filter(candidate => memberAvailable(candidate.id, target.availability!)) : users;
      if (!available.length) throw new ValidationError(`${targetName} has no eligible members available during the configured shifts.`);
      const weighted = target.strategy === 'weighted_workload';
      if (weighted && (request.purpose !== 'crm_owner' || request.entity !== 'lead')) throw new ValidationError('Weighted workload requires Lead owner assignment.');
      const needsWorkload = !!target.capacity || weighted;
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
      const incoming = weighted && request.entityId ? await client.lead.findFirst({ where: { tenantId: request.tenantId, id: request.entityId }, select: { status: true } }) : null;
      const incomingWeight = LEAD_WORKLOAD_WEIGHTS[normalizeCrmStatus(incoming?.status ?? 'Inquiry')];
      const scores = weighted ? await assignmentLeadScores(client, request.tenantId, available.map(candidate => candidate.id), request.entityId) : new Map<string, number>();
      if (weighted) for (const candidate of available) scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + (pending.get(`lead:${candidate.id}`) ?? []).filter(row => row.entityId !== request.entityId).reduce((sum, row) => sum + (typeof row.weight === 'number' && Number.isFinite(row.weight) && row.weight >= 0 ? row.weight : 1), 0) + (request.previewLoads?.get(`weighted-lead:${candidate.id}`) ?? 0));
      user = weighted ? lowestWorkloadRotation(available, scores, lastId)! : available.find(candidate => candidate.id > lastId) ?? available[0];
      reason = weighted ? `Lowest weighted Lead workload (${scores.get(user.id) ?? 0}); round-robin resolves ties` : 'Next active eligible member in rotation';
      if (weighted && request.dryRun) request.previewLoads?.set(`weighted-lead:${user.id}`, (request.previewLoads.get(`weighted-lead:${user.id}`) ?? 0) + incomingWeight);
      if (needsWorkload) {
        workload = load(user.id); capacityLimit = limit(user.id);
        if (!request.dryRun) {
          const pendingKey = `${metric}:${user.id}`;
          const token = randomUUID();
          // A short durable lease bridges the reservation and the existing domain-service commit.
          // Concurrent workflow actions include these leases in their workload, across workflows/pools.
          const value = [...(pending.get(pendingKey) ?? []), { token, expiresAt: Date.now() + 300000, weight: weighted ? incomingWeight : 1, ...(request.entityId ? { entityId: request.entityId } : {}) }];
          const scoped = { tenantId: request.tenantId, module: 'workflow-assignment-pending', key: pendingKey };
          await client.tenantPreference.upsert({ where: { tenantId_module_key: scoped }, create: { ...scoped, value }, update: { value } });
          reservation = { key: pendingKey, token };
        }
      }
      if (!request.dryRun) await client.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: user.id }, update: { value: user.id } });
    }
    return { assignmentTargetType: target.type, ...(target.type !== 'record_owner' ? { assignmentTargetId: target.id } : {}),
      assignmentTargetName: targetName, resolvedUserId: user.id, resolvedUserName: `${user.firstName} ${user.lastName}`,
      candidateCount, strategy: target.type === 'role' || target.type === 'group' ? target.strategy : 'direct', reason,
      ...(workload !== undefined ? { workload } : {}), ...(capacityLimit !== undefined ? { capacityLimit } : {}),
      ...(reservation ? { reservation } : {}) };
  };
  if (request.dryRun || request.target.type === 'user' || request.target.type === 'record_owner') return resolve(prisma);
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(async tx => { await fenceWorkflowLease(tx); return resolve(tx); }, { isolationLevel: 'Serializable' }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
      throw error;
    }
  }
}

/** Release capacity leases after the domain write, including failed actions. */
export async function completeWorkflowAssignment(tenantId: string, assignment: Awaited<ReturnType<typeof resolveWorkflowAssignee>>) {
  if (!assignment.reservation) return;
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async client => {
        if (assignment.reservation) {
          const key = { tenantId, module: 'workflow-assignment-pending', key: assignment.reservation.key };
          const row = await client.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
          if (row) await client.tenantPreference.update({ where: { tenantId_module_key: key }, data: { value: liveReservations(row.value, Date.now()).filter(item => item.token !== assignment.reservation!.token) } });
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
  const { reservation, ...output } = assignment;
  return output;
}
