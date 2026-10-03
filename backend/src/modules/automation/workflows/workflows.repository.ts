import { Prisma } from '@prisma/client';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import type { WorkflowDraft, WorkflowEntity } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { cleanWorkflowName, workflowNameKey, WORKFLOW_NAME_CONFLICT } from './workflow-names';
import { isSmsConfigured } from '../../../shared/services/sms.service';

export async function builderOptions(tenantId: string, marketing: boolean, access = { contacts: false, accounts: false }) {
  const [users, pipelines, templates, productInterests, accounts, contacts, leads] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } }),
    prisma.pipeline.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true, stages: { select: { id: true, name: true }, orderBy: { order: 'asc' } } } }),
    marketing ? prisma.template.findMany({ where: { tenantId, isArchived: false, type: 'Email' }, select: { id: true, name: true } }) : [],
    prisma.productInterest.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    access.accounts ? prisma.account.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    access.contacts ? prisma.contact.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
    access.contacts ? prisma.lead.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const people = (rows: Array<{ id: string; firstName: string; lastName: string }>) => rows.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
  return { users: people(users), pipelines, templates, campaigns: [], productInterests, accounts, contacts: people(contacts), leads: people(leads), smsConfigured: isSmsConfigured() };
}

export function findWorkflowById(id: string, tenantId: string) {
  return prisma.workflow.findFirst({ where: { id, tenantId } });
}
export async function listWorkflows(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const where: Prisma.WorkflowWhereInput = { tenantId, isArchived: query.archived === 'true',
    ...(query.status ? { status: { in: String(query.status).split(',') } } : {}),
    ...(query.trigger ? { trigger: { in: String(query.trigger).split(',') } } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    ...(query.search ? { name: { contains: String(query.search), mode: 'insensitive' } } : {}) };
  const ids = await sortedPageIds(query.sort === 'createdAt:desc' ? undefined : query.sort, ['name', 'status', 'createdAt'], (page - 1) * limit, limit,
    () => prisma.workflow.findMany({ where, select: { id: true, name: true, status: true, createdAt: true } }));
  const [rows, total] = await Promise.all([
    prisma.workflow.findMany({ where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    prisma.workflow.count({ where }),
  ]);
  const runs = await prisma.workflowExecutionRun.groupBy({ by: ['workflowId', 'status'],
    where: { tenantId, workflowId: { in: rows.map(row => row.id) } }, _max: { startedAt: true }, _count: { _all: true } });
  return { rows: orderPage(rows, ids).map(row => {
    const history = runs.filter(run => run.workflowId === row.id);
    return { ...row, lastRunAt: history.reduce<Date | null>((latest, run) => !latest || (run._max.startedAt && run._max.startedAt > latest) ? run._max.startedAt : latest, null),
      totalRuns: history.reduce((sum, run) => sum + run._count._all, 0),
      successfulRuns: history.find(run => run.status === 'completed')?._count._all ?? 0,
      failedRuns: history.find(run => run.status === 'failed')?._count._all ?? 0 };
  }), total, page, limit };
}
function workflowData(draft: Partial<WorkflowDraft>): Prisma.WorkflowUncheckedUpdateInput {
  return { ...draft, conditions: draft.conditions === null ? Prisma.DbNull : draft.conditions,
    actions: draft.actions as Prisma.InputJsonValue | undefined };
}
export function workflowNames(tenantId: string, excludeId?: string) {
  // Archived names remain reserved. Selecting only the name avoids loading definitions.
  return prisma.workflow.findMany({ where: { tenantId, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { name: true } });
}

async function assertNameAvailable(tenantId: string, name: string, excludeId?: string) {
  const key = workflowNameKey(name);
  if ((await workflowNames(tenantId, excludeId)).some(row => workflowNameKey(row.name) === key)) {
    throw new ValidationError(WORKFLOW_NAME_CONFLICT);
  }
}

function rethrowNameConflict(error: unknown): never {
  // The expression index is the final guard when simultaneous saves pass the precheck.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ValidationError(WORKFLOW_NAME_CONFLICT);
  }
  throw error;
}

export async function createWorkflow(tenantId: string, draft: WorkflowDraft, activatedById?: string) {
  const name = cleanWorkflowName(draft.name);
  await assertNameAvailable(tenantId, name);
  try {
    return await prisma.workflow.create({ data: { ...draft, name, tenantId, status: draft.isActive ? 'ACTIVE' : 'DRAFT', activatedById,
      conditions: draft.conditions == null ? Prisma.DbNull : draft.conditions,
      actions: draft.actions as Prisma.InputJsonValue } });
  } catch (error) { rethrowNameConflict(error); }
}
export async function updateWorkflow(id: string, tenantId: string, draft: Partial<WorkflowDraft> & { isArchived?: boolean; status?: string; activatedById?: string }) {
  if (draft.name !== undefined) {
    draft = { ...draft, name: cleanWorkflowName(draft.name) };
    await assertNameAvailable(tenantId, draft.name!, id);
  }
  try {
    return await prisma.workflow.update({ where: { id, tenantId }, data: workflowData(draft) });
  } catch (error) { rethrowNameConflict(error); }
}
export function activeWorkflows(tenantId: string, trigger: string) {
  return prisma.workflow.findMany({ where: { tenantId, trigger, isActive: true, isArchived: false } });
}
export async function startRun(params: { tenantId: string; workflowId: string; triggerType: string; entityType: string; entityId: string; eventId: string; recordName: string }) {
  try { return await prisma.$transaction(async tx => {
    const trigger = await tx.workflowTriggerRecord.create({ data: { tenantId: params.tenantId, workflowId: params.workflowId, triggerType: params.triggerType, entityType: params.entityType, entityId: params.entityId, eventId: params.eventId, payload: { recordName: params.recordName } } });
    return tx.workflowExecutionRun.create({ data: { tenantId: params.tenantId, workflowId: params.workflowId,
      triggerId: trigger.id, entityType: params.entityType, entityId: params.entityId } });
  }); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}
export function updateExecutionRun(id: string, tenantId: string, data: { status: string; completedAt?: Date; errorMessage?: string }) {
  return prisma.workflowExecutionRun.update({ where: { id, tenantId }, data });
}
export function createExecutionStep(data: { tenantId: string; executionId: string; stepIndex: number; actionType: string; status: string; output?: object; error?: string }) {
  return prisma.workflowExecutionStep.create({ data });
}
export function listExecutions(workflowId: string, tenantId: string, page = 1) {
  return prisma.workflowExecutionRun.findMany({ where: { workflowId, tenantId }, orderBy: { startedAt: 'desc' },
    skip: (page - 1) * 25, take: 25,
    include: { steps: { orderBy: { stepIndex: 'asc' } }, trigger: { select: { triggerType: true, entityType: true, triggeredAt: true, payload: true } } } });
}
export async function entityContext(entity: WorkflowEntity, id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const record = entity === 'lead' ? await prisma.lead.findFirst({ where: { id, tenantId, isArchived: false } })
    : entity === 'contact' ? await prisma.contact.findFirst({ where: { id, tenantId, isArchived: false } })
    : entity === 'account' ? await prisma.account.findFirst({ where: { id, tenantId, isArchived: false } })
    : await prisma.deal.findFirst({ where: { id, tenantId, isArchived: false }, include: { stage: true } });
  if (!record) return null;
  const context = Object.fromEntries(Object.entries(record).filter(([, value]) => value instanceof Date || value === null || Array.isArray(value) && value.every(item => typeof item === 'string') || ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [`${entity}.${key}`, value instanceof Date ? value.toISOString() : value]));
  if (entity === 'deal' && 'stage' in record) {
    context['deal.isQualified'] = !record.stage.isWon && !record.stage.isLost && record.stage.name.trim().toLowerCase() === 'qualified';
    context['deal.hasEverBeenWon'] = record.hasEverBeenWon || !!record.wonConfirmedAt || record.stage.isWon;
  }
  return context;
}
export function findActor(id: string, tenantId: string) {
  return prisma.user.findFirst({ where: { id, tenantId, status: 'ACTIVE' }, select: { id: true } });
}
export function recordRunActivity(tenantId: string, actorId: string, entity: WorkflowEntity, entityId: string, workflowId: string, runId: string, name: string, status: string) {
  return prisma.activity.create({ data: { tenantId, createdById: actorId, type: 'workflow', title: `Workflow: ${name}`,
    description: `Run ${status}.`, metadata: { workflowId, runId, status },
    ...(entity === 'lead' ? { leadId: entityId } : entity === 'contact' ? { contactId: entityId } : entity === 'account' ? { accountId: entityId } : { dealId: entityId }) } });
}

export function finishExecutionStep(id: string, tenantId: string, data: { status: string; output?: object; error?: string }) {
  return prisma.workflowExecutionStep.update({ where: { id, tenantId }, data });
}
export function findExecution(id: string, workflowId: string, tenantId: string) {
  return prisma.workflowExecutionRun.findFirst({ where: { id, workflowId, tenantId }, include: { steps: { orderBy: { stepIndex: 'asc' } }, trigger: true } });
}
