import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { ProductInterestIdSchema } from '@leadcrm/shared';

type Tx = Prisma.TransactionClient;
export const crmScope = (tenantId: string) => ({ tenantId });

/** Retry database serialization conflicts, including first-use preference races. */
export async function salesTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 20000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
      throw error;
    }
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
  return users.filter(user => ['leads', 'deals'].every(module => {
    const permissions = user.userRoles.flatMap(link => link.role.permissions).filter(p => p.module === module);
    return permissions.some(p => p.canView) && permissions.some(p => p.canEdit);
  }));
}

export async function validateSalesOwner(tx: Tx, tenantId: string, id: string) {
  // Client Admin already supports explicit ownership; never included in automatic rotation.
  const admin = await tx.user.findFirst({ where: { tenantId, id, status: 'ACTIVE', role: 'Client Admin' } });
  if (admin) return admin;
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
    for (const [order, name] of ['Lead', 'Contacted', 'Qualified', 'Closed Won', 'Closed Lost'].entries()) await tx.stage.create({ data: {
      ...scope, pipelineId: pipeline.id, name, order, isDefault: order === 0, isWon: name === 'Closed Won', isLost: name === 'Closed Lost', probability: name === 'Closed Won' ? 100 : 0, requiredFields: [],
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
  const agent = lead.assignedUserId ? await validateSalesOwner(tx, tenantId, lead.assignedUserId) : undefined;
  const { pipeline, initial } = await salesPipeline(tx, tenantId);
  for (const product of selected) {
    const automationKey = `${lead.id}:${product.id}`;
    const existing = await tx.deal.findFirst({ where: { ...scope, OR: [{ automationKey }, { leadId: lead.id, productInterestId: product.id }] } });
    if (existing) {
      if (!existing.assignedUserId && lead.assignedUserId) await tx.deal.update({ where: { id: existing.id, ...scope }, data: { assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId } });
      continue;
    }
    const deal = await tx.deal.create({ data: { ...scope, automationKey, leadId: lead.id, title: `${lead.firstName} ${lead.lastName} – ${product.name}`.slice(0, 255),
      productInterestId: product.id, productInterestIds: [product.id], productInterests: [product.name], value: Number(product.dealValue), assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId,
      pipelineId: pipeline.id, stageId: initial.id, accountId: lead.accountId, leadSource: lead.source, tags: [] } });
    await tx.leadDeal.create({ data: { ...scope, leadId: lead.id, dealId: deal.id, addedById: actorId } });
    if (actorId || lead.assignedUserId) await tx.activity.create({ data: { ...scope, dealId: deal.id, createdById: (actorId ?? lead.assignedUserId)!,
      type: 'deal_action', title: `Deal created for ${product.name}; ${agent ? 'assigned to ' + agent.firstName + ' ' + agent.lastName : 'awaiting assignment'}`, description: "System created this Deal from the Lead's Product Interest." } });
  }
}

export async function createAssignedLead(tx: Tx, input: Prisma.LeadUncheckedCreateInput, actorId?: string) {
  const scope = crmScope(input.tenantId);
  if (input.creationKey) {
    const existing = await tx.lead.findFirst({ where: { ...scope, creationKey: input.creationKey } });
    if (existing) return existing;
  }
  if (input.status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before closing this customer.');
  if (input.accountId && !await tx.account.findFirst({ where: { ...scope, id: input.accountId, isArchived: false } })) throw new ValidationError('Account is unavailable in this workspace.');
  // API callers provide IDs. Trusted imports may still provide historical names; resolve them here.
  const products = input.productInterestIds
    ? await resolveProducts(tx, scope.tenantId, input.productInterestIds as string[])
    : await tx.productInterest.findMany({ where: { tenantId: scope.tenantId, active: true, name: { in: (input.productInterest ?? []) as string[] } } });
  if (!input.productInterestIds && new Set((input.productInterest ?? []) as string[]).size !== products.length) throw new ValidationError('Unknown Product Interest');
  const lead = await tx.lead.create({ data: { ...input, ...scope, productInterestIds: products.map(p => p.id), productInterest: products.map(p => p.name), assignedUserId: null } });
  const agents = await eligibleAgents(tx, scope.tenantId);
  let agent = input.assignedUserId ? await validateSalesOwner(tx, scope.tenantId, input.assignedUserId) : undefined;
  if (!agent && agents.length) {
    const key = { tenantId: scope.tenantId, module: 'lead-assignment', key: 'default' };
    const cursor = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
    const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
    agent = agents[(agents.findIndex(user => user.id === lastId) + 1) % agents.length];
    await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: agent.id }, update: { value: agent.id } });
  }
  if (agent) {
    await tx.lead.update({ where: { id: lead.id, ...scope }, data: { assignedUserId: agent.id } });
    await tx.activity.create({ data: { ...scope, leadId: lead.id, createdById: actorId ?? agent.id, type: 'assignment',
      title: `Lead ${agent ? 'assigned to ' + agent.firstName + ' ' + agent.lastName : 'awaiting assignment'}`, description: `${input.assignedUserId ? 'Explicit' : 'System round-robin'} assignment.` } });
  }
  await createProductDeals(tx, scope.tenantId, lead.id, actorId);
  return tx.lead.findFirstOrThrow({ where: { id: lead.id, ...scope }, include: { assignedUser: { select: { id: true, firstName: true, lastName: true } } } });
}
