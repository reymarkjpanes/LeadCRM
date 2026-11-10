import { creatorWhere } from '../../crm/access/record-visibility';
import { Prisma, type Workflow } from '@prisma/client';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import { workflowStatusLabel, WORKFLOW_OUTCOME_STATUSES, type WorkflowExecutionView } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { getCrmFieldCatalog, getWorkflowConditionFields, customFieldTechnicalKey, parseStoredCrmStatus, FieldLayoutSchema, CUSTOM_FIELD_MODULES, WORKFLOW_MODULES, type WorkflowDraft, type WorkflowEntity, type FieldLayout } from '@leadcrm/shared';
import { workflowCustomFields } from './workflow-fields';
import { readRecordValues } from '../../crm/closing-requirements/custom-field-values.repository';
import { ConflictError, ValidationError } from '../../../shared/errors/http-error';
import { cleanWorkflowName, workflowNameKey, WORKFLOW_NAME_CONFLICT } from './workflow-names';
import { assignmentOptions } from '../assignment/workflow-assignment.repository';
import { isSmsConfigured } from '../../../shared/services/sms.service';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { crmActor, resolveCrmActor, crmPolicyReadWhere } from '../../crm/access/crm-record-access.service';
import { workflowLeaseWrite } from './workflow-lease';

async function executionVisibility(tenantId: string): Promise<Prisma.WorkflowExecutionRunWhereInput> {
  const actor = crmActor.getStore();
  if (!actor) return {}; // Internal worker/tests have explicit tenant authority.
  const policy = await resolveCrmActor(prisma, actor);
  if (policy.clientAdmin) return {};
  const modules = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' } as const;
  const delegates = { lead: prisma.lead, contact: prisma.contact, account: prisma.account, deal: prisma.deal };
  const scopes = await Promise.all(Object.entries(modules).map(async ([entity, module]) => {
    const where = crmPolicyReadWhere(policy, module);
    if (Object.keys(where).every(key => key === 'tenantId')) return { entityType: entity };
    const ids = await (delegates[entity as keyof typeof delegates] as typeof prisma.lead).findMany({
      where, select: { id: true },
    });
    return { entityType: entity, entityId: { in: ids.map(row => row.id) } };
  }));
  return { OR: scopes };
}

function executionOutcomes(view: WorkflowExecutionView): Prisma.WorkflowExecutionRunWhereInput {
  return view === 'outcomes' ? { status: { in: [...WORKFLOW_OUTCOME_STATUSES] } } : {};
}

/** Dispatch snapshots and provider recovery evidence are server-only. */
function executionDealIds(output: unknown): string[] {
  if (!output || typeof output !== 'object') return [];
  const value = output as Record<string, unknown>;
  const ids = ['dealIds', 'matchedDealIds', 'movedDealIds'].flatMap(key =>
    Array.isArray(value[key]) ? value[key].filter((id): id is string => typeof id === 'string') : []);
  if (typeof value.failedDealId === 'string') ids.push(value.failedDealId);
  if (Array.isArray(value.deals)) for (const deal of value.deals) {
    if (deal && typeof deal === 'object' && 'id' in deal && typeof deal.id === 'string') ids.push(deal.id);
  }
  return ids;
}
async function visibleExecutionDeals(tenantId: string, runs: Array<{ steps: Array<{ output: unknown }> }>): Promise<Set<string> | null> {
  const actor = crmActor.getStore();
  if (!actor) return null;
  const policy = await resolveCrmActor(prisma, actor);
  if (policy.clientAdmin) return null;
  const ids = [...new Set(runs.flatMap(run => run.steps.flatMap(step => executionDealIds(step.output))))];
  if (!ids.length) return new Set<string>();
  const deals = await prisma.deal.findMany({ where: { tenantId, id: { in: ids }, AND: [crmPolicyReadWhere(policy, 'deals')] }, select: { id: true } });
  return new Set(deals.map(deal => deal.id));
}
function presentExecution<T extends { dispatchContext: unknown; leaseId: unknown; leaseUntil: unknown; dispatchStartedAt: unknown; steps: Array<{ resolvedInput: unknown; actionType: string; output: unknown }> }>(run: T, visibleDeals: Set<string> | null) {
  const { dispatchContext: _context, leaseId: _lease, leaseUntil: _until, dispatchStartedAt: _started, ...visible } = run;
  return { ...visible, steps: visible.steps.map(({ resolvedInput: _input, ...step }) => {
    if (visibleDeals && step.output && typeof step.output === 'object') {
      const output = { ...step.output } as Record<string, unknown>;
      const ids = executionDealIds(output);
      // Historical association summaries without target IDs cannot establish current visibility.
      const legacyAssociations = !ids.length && !Array.isArray(output.dealIds) &&
        ['dealNames', 'dealCount', 'associationSummary'].some(key => key in output);
      if (legacyAssociations || ids.some(id => !visibleDeals.has(id))) {
        for (const key of ['dealIds', 'deals', 'dealNames', 'dealCount', 'associationSummary', 'matchedDealIds', 'movedDealIds', 'failedDealId']) delete output[key];
        return { ...step, output };
      }
    }
    if (!['send_email', 'send_sms'].includes(step.actionType)) return step;
    const warnings = step.actionType === 'send_email' && step.output && typeof step.output === 'object' && 'warnings' in step.output && Array.isArray(step.output.warnings)
      ? step.output.warnings.filter((warning): warning is string => typeof warning === 'string') : [];
    return { ...step, output: warnings.length ? { warnings } : null };
  }) };
}

export async function builderOptions(tenantId: string, marketing: boolean, access: { contacts: boolean; accounts: boolean; leads: boolean; deals: boolean; products: boolean; users: boolean; roles?: boolean; groups?: boolean } = { contacts: false, accounts: false, leads: false, deals: false, products: false, users: false }) {
  const [assignments, pipelines, templates, productInterests, accounts, contacts, leads] = await Promise.all([
    access.users || access.roles || access.groups ? assignmentOptions(prisma, tenantId, { users: access.users, roles: !!access.roles, groups: !!access.groups }) : { users: [], taskAssignees: [], roles: [], groups: [] },
    access.deals ? prisma.pipeline.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true, stages: { where: { tenantId }, select: { id: true, name: true, order: true, isDefault: true, isWon: true, isLost: true, requiredFields: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } } }) : [],
    marketing ? prisma.template.findMany({ where: { tenantId, isArchived: false, type: 'Email' }, select: { id: true, name: true } }) : [],
    access.products ? prisma.productInterest.findMany({ where: { tenantId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    access.accounts ? prisma.account.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    access.contacts ? prisma.contact.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
    access.leads ? prisma.lead.findMany({ where: { tenantId, isArchived: false }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const people = (rows: Array<{ id: string; firstName: string; lastName: string }>) => rows.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
  const preferences = await prisma.tenantPreference.findMany({ where: { tenantId, key: 'field-layout', module: { in: CUSTOM_FIELD_MODULES.filter(module => access[module]) } } });
  const fieldLayouts: Partial<Record<typeof CUSTOM_FIELD_MODULES[number], FieldLayout>> = {};
  for (const preference of preferences) { const parsed = FieldLayoutSchema.safeParse(preference.value); if (parsed.success) fieldLayouts[parsed.data.module] = parsed.data; }
  return { fieldLayouts, customFields: (await workflowCustomFields(tenantId)).filter(field => access[field.module]), ...assignments, pipelines, templates, campaigns: [], productInterests, accounts, contacts: people(contacts), leads: people(leads), smsConfigured: isSmsConfigured() };
}

export function findWorkflowById(id: string, tenantId: string) {
  return prisma.workflow.findFirst({ where: { id, tenantId } });
}
export async function findVisibleWorkflowById(id: string, tenantId: string) {
  return prisma.workflow.findFirst({ where: { id, ...await creatorWhere(tenantId, prisma, 'Workflow') } });
}
export async function listWorkflows(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const where: Prisma.WorkflowWhereInput = { ...await creatorWhere(tenantId, prisma, 'Workflow'), isArchived: query.archived === 'true',
    ...(query.status ? { status: { in: String(query.status).split(',') } } : {}),
    ...(query.trigger ? { trigger: { in: String(query.trigger).split(',') } } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    AND: buildSearchClauses(query.search, ['name']) };
  const ids = await sortedPageIds(query.sort === 'createdAt:desc' ? undefined : query.sort, ['name', 'status', 'createdAt'], (page - 1) * limit, limit,
    async () => (await prisma.workflow.findMany({ where, select: { id: true, name: true, status: true, isActive: true, createdAt: true } }))
      .map(row => ({ ...row, status: workflowStatusLabel(row) })));
  const [rows, total] = await Promise.all([
    prisma.workflow.findMany({ where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    prisma.workflow.count({ where }),
  ]);
  const runs = await prisma.workflowExecutionRun.groupBy({ by: ['workflowId', 'status'],
    where: { tenantId, workflowId: { in: rows.map(row => row.id) }, ...executionOutcomes(query.view === 'outcomes' ? 'outcomes' : 'all'), ...await executionVisibility(tenantId) }, _max: { startedAt: true }, _count: { _all: true } });
  return { rows: orderPage(rows, ids).map(row => {
    const history = runs.filter(run => run.workflowId === row.id);
    return { ...row, lastRunAt: history.reduce<Date | null>((latest, run) => !latest || (run._max.startedAt && run._max.startedAt > latest) ? run._max.startedAt : latest, null),
      totalRuns: history.reduce((sum, run) => sum + run._count._all, 0),
      successfulRuns: history.find(run => run.status === 'completed')?._count._all ?? 0,
      failedRuns: history.filter(run => run.status === 'failed' || query.view === 'outcomes' && run.status === 'interrupted').reduce((sum, run) => sum + run._count._all, 0) };
  }), total, page, limit };
}
function workflowData(draft: Partial<WorkflowDraft>): Prisma.WorkflowUncheckedUpdateInput {
  return { ...draft, conditions: draft.conditions === null ? Prisma.DbNull : draft.conditions,
    actions: draft.actions as Prisma.InputJsonValue | undefined };
}
export function workflowNames(tenantId: string, excludeId?: string) {
  // Archived names remain reserved. Selecting only the name avoids loading definitions.
  const read = () => prisma.workflow.findMany({ where: { tenantId, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { name: true } });
  const actor = crmActor.getStore();
  // Tenant-wide uniqueness includes inaccessible archived names. Only the generic
  // availability result is exposed, never definitions or record identities.
  return actor ? crmActor.run({ ...actor, readRecords: false }, async () => await read()) : read();
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

export async function createWorkflow(tenantId: string, draft: WorkflowDraft, activatedById?: string, createdById?: string) {
  const name = cleanWorkflowName(draft.name);
  await assertNameAvailable(tenantId, name);
  try {
    return await prisma.$transaction(async tx => {
      const created = await tx.workflow.create({ data: { ...draft, name, tenantId, createdById, status: draft.isActive ? 'ACTIVE' : 'DRAFT', activatedById,
        conditions: draft.conditions == null ? Prisma.DbNull : draft.conditions, actions: draft.actions as Prisma.InputJsonValue } });
      if (draft.isActive) await tx.workflowPublication.create({ data: { tenantId, workflowId: created.id, version: created.version, activatedById, definition: draft as unknown as Prisma.InputJsonValue } });
      return created;
    });
  } catch (error) { rethrowNameConflict(error); }
}
export async function updateWorkflow(id: string, tenantId: string, draft: Partial<WorkflowDraft> & { isArchived?: boolean; status?: string; activatedById?: string },
  expected?: Pick<Workflow, 'version' | 'draftRevision' | 'updatedAt' | 'isActive' | 'status' | 'isArchived' | 'activatedById' | 'name' | 'description'>,
  definitionChanged = false) {
  if (draft.name !== undefined) {
    draft = { ...draft, name: cleanWorkflowName(draft.name) };
    await assertNameAvailable(tenantId, draft.name!, id);
  }
  try {
    return await prisma.$transaction(async tx => {
      const match = expected && { version: expected.version, draftRevision: expected.draftRevision, updatedAt: expected.updatedAt,
        isActive: expected.isActive, status: expected.status, isArchived: expected.isArchived, activatedById: expected.activatedById,
        name: expected.name, description: expected.description };
      const updated = await tx.workflow.update({ where: { id, ...await creatorWhere(tenantId, tx, 'Workflow'), ...match }, data: { ...workflowData(draft), ...(definitionChanged ? { version: { increment: 1 } } : {}) } });
      if (updated.isActive) {
        const definition = { name: updated.name, description: updated.description, trigger: updated.trigger, conditions: updated.conditions, actions: updated.actions, isActive: true };
        await tx.workflowPublication.upsert({ where: { workflowId_tenantId_version: { workflowId: id, tenantId, version: updated.version } }, create: { tenantId, workflowId: id, version: updated.version, activatedById: updated.activatedById, definition }, update: {} });
      }
      return updated;
    });
  } catch (error) {
    if (expected && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new ConflictError('This workflow changed while you were editing. Reload and try again.');
    rethrowNameConflict(error);
  }
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
  return workflowLeaseWrite(tx => tx.workflowExecutionStep.create({ data }));
}
export async function countExecutions(workflowId: string, tenantId: string, view: WorkflowExecutionView = 'all') {
  return prisma.workflowExecutionRun.count({ where: { workflowId, tenantId, ...executionOutcomes(view), ...await executionVisibility(tenantId) } });
}
export async function listExecutions(workflowId: string, tenantId: string, page = 1, limit = 25, view: WorkflowExecutionView = 'all') {
  const rows = await prisma.workflowExecutionRun.findMany({ where: { workflowId, tenantId, ...executionOutcomes(view), ...await executionVisibility(tenantId) }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * limit, take: limit,
    include: { steps: { orderBy: { stepIndex: 'asc' } }, trigger: { select: { triggerType: true, entityType: true, triggeredAt: true, payload: true } } } });
  const dealsVisible = await visibleExecutionDeals(tenantId, rows);
  return rows.map(row => presentExecution(row, dealsVisible));
}
export async function entityContext(entity: WorkflowEntity, id: string, tenantId: string, db: Prisma.TransactionClient = prisma): Promise<Record<string, unknown> | null> {
  const where = { id, tenantId, isArchived: false, deletedAt: null };
  const record = entity === 'lead' ? await db.lead.findFirst({ where, include: { productLinks: true } })
    : entity === 'contact' ? await db.contact.findFirst({ where, include: { productLinks: true } })
    : entity === 'account' ? await db.account.findFirst({ where })
    : await db.deal.findFirst({ where, include: { stage: true,
      leadDeals: { orderBy: [{ position: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }] },
      contactDeals: { orderBy: [{ position: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }] },
    } });
  if (!record) return null;
  // Internal dispatch identity and suppression are deliberately not condition fields.
  const context: Record<string, unknown> = { [entity + '.id']: record.id };
  const source = record as unknown as Record<string, unknown>;
  for (const field of getCrmFieldCatalog(WORKFLOW_MODULES[entity])) {
    const value = source[field.technicalKey];
    context[`${entity}.${field.technicalKey}`] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  for (const field of getWorkflowConditionFields(entity)) {
    const key = field.field.slice(entity.length + 1), value = source[key];
    context[field.field] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  if ('status' in record) {
    context[entity + '.status'] = parseStoredCrmStatus(record.status) ?? null;
    context['internal.statusChangedAt'] = record.lastStatusChangedAt?.toISOString() ?? null;
  }
  if ('doNotContact' in record) context['contact.doNotContact'] = record.doNotContact;
  if ('productLinks' in record) {
    context[entity + '.productInterestIds'] = record.productLinks.filter(link => !('interested' in link) || link.interested).map(link => link.productInterestId).sort();
  }
  if ('stage' in record) {
    context['deal.engagementStatus'] = parseStoredCrmStatus(record.engagementStatus) ?? null;
    context['internal.stageHistoryId'] = record.currentStageHistoryId ?? null;
    context['deal.productInterestIds'] = record.productInterestId ? [record.productInterestId] : [];
    context['deal.leadIds'] = record.leadDeals.map(link => link.leadId);
    context['deal.contactIds'] = record.contactDeals.map(link => link.contactId);
    context['deal.leadId'] = record.leadDeals[0]?.leadId ?? null;
    context['deal.contactId'] = record.contactDeals[0]?.contactId ?? null;
    context['deal.isQualified'] = !record.stage.isWon && !record.stage.isLost && record.stage.name.trim().toLowerCase() === 'qualified';
    context['deal.hasEverBeenWon'] = record.hasEverBeenWon || !!record.wonConfirmedAt || record.stage.isWon;
  }
  const definitions = await workflowCustomFields(tenantId, db);
  const values = await readRecordValues(db, tenantId, WORKFLOW_MODULES[entity], id);
  for (const field of getWorkflowConditionFields(entity, undefined, definitions).filter(f => f.customFieldId)) {
    context[field.field] = values[field.customFieldId!] ?? null;
    const definition = definitions.find(item => item.id === field.customFieldId)!;
    context[`${entity}.${customFieldTechnicalKey(definition)}`] = context[field.field];
  }
  return context;
}
export function findActor(id: string, tenantId: string) {
  return prisma.user.findFirst({ where: { id, tenantId, status: 'ACTIVE' }, select: { id: true } });
}
export function recordRunActivity(tenantId: string, actorId: string, entity: WorkflowEntity, entityId: string, workflowId: string, runId: string, name: string, status: string, db: Prisma.TransactionClient = prisma) {
  if (status === 'skipped') return Promise.resolve(null);
  return db.activity.create({ data: { tenantId, createdById: actorId, type: 'workflow', title: `Workflow: ${name}`,
    description: `Run ${status}.`, metadata: { workflowId, runId, status },
    ...(entity === 'lead' ? { leadId: entityId } : entity === 'contact' ? { contactId: entityId } : entity === 'account' ? { accountId: entityId } : { dealId: entityId }) } });
}

export function finishExecutionStep(id: string, tenantId: string, data: { status: string; output?: object; error?: string }) {
  return workflowLeaseWrite(tx => tx.workflowExecutionStep.update({ where: { id, tenantId }, data }));
}
export async function findExecution(id: string, workflowId: string, tenantId: string) {
  const run = await prisma.workflowExecutionRun.findFirst({ where: { id, workflowId, tenantId, ...await executionVisibility(tenantId) }, include: { steps: { orderBy: { stepIndex: 'asc' } }, trigger: true } });
  return run ? presentExecution(run, await visibleExecutionDeals(tenantId, [run])) : null;
}
