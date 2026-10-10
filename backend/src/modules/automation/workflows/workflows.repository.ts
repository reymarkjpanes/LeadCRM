import { Prisma } from '@prisma/client';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { getWorkflowConditionFields, CRM_STATUSES, WORKFLOW_MODULES, type WorkflowDraft, type WorkflowEntity } from '@leadcrm/shared';
import { workflowCustomFields } from './workflow-fields';
import { readRecordValues } from '../../crm/closing-requirements/custom-field-values.repository';
import { ValidationError } from '../../../shared/errors/http-error';
import { cleanWorkflowName, workflowNameKey, WORKFLOW_NAME_CONFLICT } from './workflow-names';
import { assignmentOptions } from '../assignment/workflow-assignment.repository';
import { isSmsConfigured } from '../../../shared/services/sms.service';

export async function builderOptions(tenantId: string, marketing: boolean, access: { contacts: boolean; accounts: boolean; leads: boolean; deals: boolean; products: boolean; users: boolean; roles?: boolean; groups?: boolean } = { contacts: false, accounts: false, leads: false, deals: false, products: false, users: false }) {
  const [assignments, pipelines, templates, productInterests, accounts, contacts, leads, senders] = await Promise.all([
    access.users || access.roles || access.groups ? assignmentOptions(prisma, tenantId, { users: access.users, roles: !!access.roles, groups: !!access.groups }) : { users: [], taskAssignees: [], roles: [], groups: [] },
    access.deals ? prisma.pipeline.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true, stages: { select: { id: true, name: true }, orderBy: { order: 'asc' } } } }) : [],
    marketing ? prisma.template.findMany({ where: { tenantId, isArchived: false, type: 'Email' }, select: { id: true, name: true } }) : [],
    access.products ? prisma.productInterest.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    access.accounts ? prisma.account.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    access.contacts ? prisma.contact.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
    access.leads ? prisma.lead.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
    marketing && access.users ? connectedSenders(tenantId) : [],
  ]);
  const people = (rows: Array<{ id: string; firstName: string; lastName: string }>) => rows.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
  return { customFields: (await workflowCustomFields(tenantId)).filter(field => access[field.module]), ...assignments, senders: people(senders), pipelines, templates, campaigns: [], productInterests, accounts, contacts: people(contacts), leads: people(leads), smsConfigured: isSmsConfigured() };
}

async function connectedSenders(tenantId: string) {
  const accounts = await prisma.emailAccount.findMany({ where: { tenantId, isActive: true, provider: 'gmail' }, select: { userId: true } });
  return prisma.user.findMany({ where: { tenantId, status: 'ACTIVE', id: { in: accounts.map(account => account.userId) } }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } });
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
export async function updateWorkflow(id: string, tenantId: string, draft: Partial<WorkflowDraft> & { isArchived?: boolean; status?: string; activatedById?: string }, definitionChanged = false) {
  if (draft.name !== undefined) {
    draft = { ...draft, name: cleanWorkflowName(draft.name) };
    await assertNameAvailable(tenantId, draft.name!, id);
  }
  try {
    return await prisma.workflow.update({ where: { id, tenantId }, data: { ...workflowData(draft), ...(definitionChanged ? { version: { increment: 1 } } : {}) } });
  } catch (error) { rethrowNameConflict(error); }
}
export function activeWorkflows(tenantId: string, trigger: string) {
  return prisma.workflow.findMany({ where: { tenantId, trigger, isActive: true, status: 'ACTIVE', isArchived: false } });
}
export async function startRun(params: { tenantId: string; workflowId: string; triggerType: string; entityType: string; entityId: string; eventId: string; recordName: string; workflowVersion: number; definitionSnapshot: Prisma.InputJsonValue }) {
  try { return await prisma.$transaction(async tx => {
    const trigger = await tx.workflowTriggerRecord.create({ data: { tenantId: params.tenantId, workflowId: params.workflowId, triggerType: params.triggerType, entityType: params.entityType, entityId: params.entityId, eventId: params.eventId, payload: { recordName: params.recordName } } });
    return tx.workflowExecutionRun.create({ data: { tenantId: params.tenantId, workflowId: params.workflowId,
      triggerId: trigger.id, entityType: params.entityType, entityId: params.entityId,
      workflowVersion: params.workflowVersion, definitionSnapshot: params.definitionSnapshot } });
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
export function countExecutions(workflowId: string, tenantId: string) {
  return prisma.workflowExecutionRun.count({ where: { workflowId, tenantId } });
}
export function listExecutions(workflowId: string, tenantId: string, page = 1, limit = 25) {
  return prisma.workflowExecutionRun.findMany({ where: { workflowId, tenantId }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * limit, take: limit,
    include: { steps: { orderBy: { stepIndex: 'asc' } }, trigger: { select: { triggerType: true, entityType: true, triggeredAt: true, payload: true } } } });
}
export async function entityContext(entity: WorkflowEntity, id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const where = { id, tenantId, isArchived: false };
  const record = entity === 'lead' ? await prisma.lead.findFirst({ where, include: { productLinks: true } })
    : entity === 'contact' ? await prisma.contact.findFirst({ where, include: { productLinks: true } })
    : entity === 'account' ? await prisma.account.findFirst({ where, include: { productLinks: true } })
    : await prisma.deal.findFirst({ where, include: { stage: true,
      leadDeals: { orderBy: [{ position: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }] },
      contactDeals: { orderBy: [{ position: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }] },
    } });
  if (!record) return null;
  // Internal dispatch identity and suppression are deliberately not condition fields.
  const context: Record<string, unknown> = { [entity + '.id']: record.id };
  const source = record as unknown as Record<string, unknown>;
  for (const field of getWorkflowConditionFields(entity)) {
    const key = field.field.slice(entity.length + 1), value = source[key];
    context[field.field] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  if ('status' in record) context[entity + '.status'] = CRM_STATUSES.find(status => status.toLowerCase() === record.status.toLowerCase()) ?? record.status;
  if ('doNotContact' in record) context['contact.doNotContact'] = record.doNotContact;
  if ('productLinks' in record) {
    context[entity + '.productInterestIds'] = record.productLinks.filter(link => !('interested' in link) || link.interested).map(link => link.productInterestId).sort();
    if (entity === 'account') context['account.activeProductIds'] = record.productLinks.filter(link => 'activeProduct' in link && link.activeProduct).map(link => link.productInterestId).sort();
  }
  if ('stage' in record) {
    context['deal.productInterestIds'] = record.productInterestId ? [record.productInterestId] : [];
    context['deal.leadIds'] = record.leadDeals.map(link => link.leadId);
    context['deal.contactIds'] = record.contactDeals.map(link => link.contactId);
    context['deal.leadId'] = record.leadDeals[0]?.leadId ?? null;
    context['deal.contactId'] = record.contactDeals[0]?.contactId ?? null;
    context['deal.isQualified'] = !record.stage.isWon && !record.stage.isLost && record.stage.name.trim().toLowerCase() === 'qualified';
    context['deal.hasEverBeenWon'] = record.hasEverBeenWon || !!record.wonConfirmedAt || record.stage.isWon;
  }
  const definitions = await workflowCustomFields(tenantId);
  const values = await readRecordValues(prisma, tenantId, WORKFLOW_MODULES[entity], id);
  for (const field of getWorkflowConditionFields(entity, undefined, definitions).filter(f => f.customFieldId)) context[field.field] = values[field.customFieldId!] ?? null;
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
