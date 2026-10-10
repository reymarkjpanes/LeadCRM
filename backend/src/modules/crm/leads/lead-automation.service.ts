import { setNotificationActor } from '../../notifications/notification-actor';
import { cancelOpenDeals } from '../engagement.service';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fireLeadCreated, fireDealCreated, fireDealUpdated } from '../../automation/triggers/triggers.service';
import { isAssignableAgent, SALES_PIPELINE_STAGES, pipelineStageColor } from '@leadcrm/shared';
import { ProductInterestIdSchema } from '@leadcrm/shared';
import { productRelationData } from './product-relations';

type Tx = Prisma.TransactionClient;
export const crmScope = (tenantId: string) => ({ tenantId });

// Each serialization attempt gets its own effects. Failed attempts are discarded.
const committedEffects = new AsyncLocalStorage<Array<() => Promise<void>>>();
export function afterSalesCommit(effect: () => Promise<void>) {
  const effects = committedEffects.getStore();
  if (!effects) throw new Error('Sales writes require salesTransaction.');
  effects.push(effect);
}
/** Serializable writes with side effects dispatched only after the successful commit. */
export async function salesTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const effects: Array<() => Promise<void>> = [];
    let result: T;
    try { result = await committedEffects.run(effects, () => prisma.$transaction(async tx => {
      await setNotificationActor(tx);
      return work(tx);
    }, { isolationLevel: 'Serializable', timeout: 20000 })); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
      throw error;
    }
    for (const effect of effects) await effect();
    return result;
  }
}

export async function productConfiguration(tx: Tx, tenantId: string) {
  const rows = await tx.productInterest.findMany({ where: { tenantId, active: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map(p => ({ ...p, dealValue: Number(p.dealValue), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }));
}

export async function resolveProducts(tx: Tx, tenantId: string, ids: string[]) {
  const unique = [...new Set(ids.map(id => ProductInterestIdSchema.parse(id)))];
  const products = await tx.productInterest.findMany({ where: { tenantId, active: true, id: { in: unique } } });
  if (products.length !== unique.length) throw new ValidationError('Select available Product Interests.');
  return unique.map(id => products.find(p => p.id === id)!);
}

export async function eligibleAgents(tx: Tx, tenantId: string) {
  const users = await tx.user.findMany({ where: { tenantId, status: 'ACTIVE', role: { notIn: ['Client Admin', 'Guest'] } },
    include: { userRoles: { where: { tenantId, role: { tenantId, isArchived: false, NOT: { name: { equals: 'Guest', mode: 'insensitive' } } } }, include: { role: { include: { permissions: { where: { tenantId } } } } } } }, orderBy: { id: 'asc' } });
  return users.filter(user => isAssignableAgent({ ...user, assignableAgent: ['leads', 'deals'].every(module => {
    const permissions = user.userRoles.flatMap(link => link.role.permissions).filter(p => p.module === module);
    return permissions.some(p => p.canView) && permissions.some(p => p.canEdit);
  }) }));
}

export async function validateSalesOwner(tx: Tx, tenantId: string, id: string) {
  const owner = (await eligibleAgents(tx, tenantId)).find(user => user.id === id);
  if (!owner) throw new ValidationError('Choose an active sales agent with Lead and Deal permissions in this workspace.');
  return owner;
}

export async function salesPipeline(tx: Tx, tenantId: string) {
  const scope = crmScope(tenantId);
  let pipeline = await tx.pipeline.findFirst({ where: { ...scope, name: { equals: 'Sales Pipeline', mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
  if (pipeline?.isArchived) pipeline = await tx.pipeline.update({ where: { id: pipeline.id, ...scope }, data: { isArchived: false } });
  if (!pipeline) pipeline = await tx.pipeline.create({ data: { ...scope, name: 'Sales Pipeline', type: 'Sales', isDefault: true } });
  let stages = await tx.stage.findMany({ where: { ...scope, pipelineId: pipeline.id }, orderBy: { order: 'asc' } });
  if (!stages.length) {
    for (const [order, name] of SALES_PIPELINE_STAGES.entries()) await tx.stage.create({ data: {
      ...scope, pipelineId: pipeline.id, name, color: pipelineStageColor({ name }), order, isDefault: order === 0, isWon: name === 'Closed Won', isLost: name === 'Closed Lost', probability: name === 'Closed Won' ? 100 : 0, requiredFields: [],
    } });
    stages = await tx.stage.findMany({ where: { ...scope, pipelineId: pipeline.id }, orderBy: { order: 'asc' } });
  }
  let initial = stages.find(stage => stage.name.toLowerCase() === 'lead' && !stage.isWon && !stage.isLost);
  if (!initial) initial = await tx.stage.create({ data: { ...scope, pipelineId: pipeline.id, name: 'Lead', order: Math.min(...stages.map(s => s.order)) - 1, isDefault: true, requiredFields: [] } });
  return { pipeline, initial };
}

export async function createProductDeals(tx: Tx, tenantId: string, leadId: string, actorId?: string) {
  const scope = crmScope(tenantId);
  const lead = await tx.lead.findFirstOrThrow({ where: { id: leadId, ...scope } });
  const selected = await tx.productInterest.findMany({ where: { tenantId, active: true, id: { in: lead.productInterestIds } } });
  if (!selected.length || lead.isArchived || lead.convertedAt) return;
  const agent = lead.assignedUserId ? await tx.user.findFirst({ where: { tenantId, id: lead.assignedUserId }, select: { firstName: true, lastName: true } }) : undefined;
  const { pipeline, initial } = await salesPipeline(tx, tenantId);
  for (const product of selected) {
    const automationKey = `${lead.id}:${product.id}`;
    const existing = await tx.deal.findFirst({ where: { ...scope, OR: [{ automationKey }, { leadDeals: { some: { tenantId, leadId: lead.id } }, productInterestId: product.id }] } });
    if (existing) {
      if (!existing.assignedUserId && lead.assignedUserId && !existing.isArchived) {
        const updated = await tx.deal.update({ where: { id: existing.id, ...scope }, data: { assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId } });
        afterSalesCommit(() => fireDealUpdated({ tenantId, actorId, record: updated, changedFields: ['assignedUserId'] }));
      }
      continue;
    }
    const deal = await tx.deal.create({ data: { ...scope, automationKey, title: `${lead.firstName} ${lead.lastName} – ${product.name}`.slice(0, 255),
      productInterestId: product.id, productsNormalized: true, value: Number(product.dealValue), assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId,
      pipelineId: pipeline.id, stageId: initial.id, accountId: lead.accountId, leadSource: lead.source, tags: [] } });
    afterSalesCommit(() => fireDealCreated({ tenantId, actorId, deal }));
    await tx.leadDeal.create({ data: { ...scope, leadId: lead.id, dealId: deal.id, addedById: actorId } });
    if (actorId || lead.assignedUserId) await tx.activity.create({ data: { ...scope, dealId: deal.id, createdById: (actorId ?? lead.assignedUserId)!,
      type: 'deal_action', title: `Deal created for ${product.name}; ${agent ? 'assigned to ' + agent.firstName + ' ' + agent.lastName : 'awaiting assignment'}`, description: "System created this Deal from the Lead's Product Interest." } });
  }
}

/** Shared transactional rotation for new CRM records. */
export async function resolveSalesAgent(tx: Tx, tenantId: string, assignedUserId?: string | null) {
  const agents = await eligibleAgents(tx, tenantId);
  let agent = assignedUserId ? await validateSalesOwner(tx, tenantId, assignedUserId) : undefined;
  if (!agent && agents.length) {
    const key = { tenantId: tenantId, module: 'lead-assignment', key: 'default' };
    const cursor = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
    const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
    agent = agents[(agents.findIndex(user => user.id === lastId) + 1) % agents.length];
    await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: agent.id }, update: { value: agent.id } });
  }
  return agent;
}

export async function createAssignedLead(tx: Tx, input: Prisma.LeadUncheckedCreateInput, actorId?: string) {
  const scope = crmScope(input.tenantId);
  if (input.creationKey) {
    const existing = await tx.lead.findFirst({ where: { ...scope, creationKey: input.creationKey } });
    if (existing) return existing;
  }
  if (input.status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before closing this customer.');
  if (input.accountId && !await tx.account.findFirst({ where: { ...scope, id: input.accountId, isArchived: false, deletedAt: null } })) throw new ValidationError('Account is unavailable in this workspace.');
  // API callers provide IDs. Trusted imports may still provide historical names; resolve them here.
  const products = input.productInterestIds
    ? await resolveProducts(tx, scope.tenantId, input.productInterestIds as string[])
    : await tx.productInterest.findMany({ where: { tenantId: scope.tenantId, active: true, name: { in: (input.productInterest ?? []) as string[] } } });
  if (!input.productInterestIds && new Set((input.productInterest ?? []) as string[]).size !== products.length) throw new ValidationError('Unknown Product Interest');
  const relations = await productRelationData(tx, 'lead', scope.tenantId, { ids: products.map(p => p.id) });
  const lead = await tx.lead.create({ data: { ...input, ...scope, ...relations, assignedUserId: null } });
  const agent = await resolveSalesAgent(tx, scope.tenantId, input.assignedUserId);
  if (agent) {
    await tx.lead.update({ where: { id: lead.id, ...scope }, data: { assignedUserId: agent.id, updatedAt: lead.createdAt } });
    await tx.activity.create({ data: { ...scope, leadId: lead.id, createdById: actorId ?? agent.id, type: 'assignment',
      title: `Lead ${agent ? 'assigned to ' + agent.firstName + ' ' + agent.lastName : 'awaiting assignment'}`, description: `${input.assignedUserId ? 'Explicit' : 'System round-robin'} assignment.` } });
  }
  if (actorId) await tx.auditLog.create({ data: { ...scope, userId: actorId, action: 'lead.created', entityType: 'Lead', entityId: lead.id } });
  const assignedLead = await tx.lead.findFirstOrThrow({ where: { id: lead.id, ...scope }, include: { assignedUser: { select: { id: true, firstName: true, lastName: true } } } });
  afterSalesCommit(() => fireLeadCreated({ tenantId: scope.tenantId, actorId, lead: assignedLead }));
  await createProductDeals(tx, scope.tenantId, lead.id, actorId);
  if (lead.status === 'Cancelled' && actorId) await cancelOpenDeals(tx, scope.tenantId, actorId, { leadId: lead.id }, 'Staff created a cancelled opportunity.');
  return assignedLead;
}
