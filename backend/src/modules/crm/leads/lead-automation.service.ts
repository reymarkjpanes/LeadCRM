import { classifyCustomerRecord } from '../customer-classification.service';
import { assertExternalCustomerEmail, assertExternalCustomerPhone } from '../record-validation';
import { weightedLeadScores, lowestWorkloadRotation } from './lead-workload';
import { setNotificationActor, withAssignmentReason } from '../../notifications/notification-actor';
import { assertCrmCreateAssignment, isCrmTransactionConflict, runCrmAutomaticCreation } from '../access/crm-record-access.service';
import { cancelOpenDeals } from '../engagement.service';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { ValidationError } from '../../../shared/errors/http-error';
import { fireLeadCreated, fireDealCreated, fireDealUpdated } from '../../automation/triggers/triggers.service';
import { SALES_PIPELINE_STAGES, pipelineStageColor } from '@leadcrm/shared';
import { ProductInterestIdSchema } from '@leadcrm/shared';
import { productRelationData } from './product-relations';
import { findSalesGroup } from '../../administration/groups/sales-group';
import { eligibleAssignedAgents, crmAssignmentRequirements } from '../access/assigned-agent-eligibility';
import type { CrmModule } from '../access/crm-record-access.service';
import { salesContext, discardWorkflowWake, workflowTransactionCommitted } from './sales-context';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { notifyRecordChanges } from '../record-change-events';
import { fenceWorkflowLease } from '../../automation/workflows/workflow-lease';

type Tx = Prisma.TransactionClient;
export const crmScope = (tenantId: string) => ({ tenantId });

/** Serializable writes capture dependent work durably; workers execute after commit. */
export async function salesTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const current = salesContext.getStore();
  if (current) { await fenceWorkflowLease(current); return work(current); }
  for (let attempt = 0; ; attempt++) {
    let result: T;
    let transaction: Tx | undefined;
    try { result = await prisma.$transaction(async tx => {
      transaction = tx;
      await fenceWorkflowLease(tx);
      await setNotificationActor(tx);
      return salesContext.run(tx, () => work(tx));
    }, { isolationLevel: 'Serializable', timeout: 20000 }); }
    catch (error) {
      if (transaction) discardWorkflowWake(transaction);
      if ((isCrmTransactionConflict(error) || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') && attempt < 4) {
        // Let concurrent writers commit before taking another serializable snapshot.
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)));
        continue;
      }
      throw error;
    }
    if (transaction) workflowTransactionCommitted(transaction);
    const tenantId = tenantContext.getStore()?.tenantId;
    if (tenantId) notifyRecordChanges(tenantId);
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

export async function eligibleAgents(tx: Tx, tenantId: string, modules: CrmModule[] = ['leads', 'deals']) {
  return eligibleAssignedAgents(tx, tenantId, modules.flatMap(module => crmAssignmentRequirements(module)));
}

export async function validateSalesOwner(tx: Tx, tenantId: string, id: string, modules: CrmModule[] = ['leads', 'deals']) {
  const owner = (await eligibleAgents(tx, tenantId, modules)).find(user => user.id === id);
  if (!owner) throw new ValidationError('Choose an active eligible agent with the required module permissions in this workspace.');
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
      ...scope, pipelineId: pipeline.id, name, color: pipelineStageColor({ name }), order, isDefault: order === 0, isWon: name === 'Closed Deal', isLost: name === 'Cancelled', probability: name === 'Closed Deal' ? 100 : 0, requiredFields: [],
    } });
    stages = await tx.stage.findMany({ where: { ...scope, pipelineId: pipeline.id }, orderBy: { order: 'asc' } });
  }
  let initial = stages.find(stage => stage.name.toLowerCase() === 'lead' && !stage.isWon && !stage.isLost);
  if (!initial) initial = await tx.stage.create({ data: { ...scope, pipelineId: pipeline.id, name: 'Lead', order: Math.min(...stages.map(s => s.order)) - 1, isDefault: true, requiredFields: [] } });
  return { pipeline, initial };
}

export async function createProductDeals(tx: Tx, tenantId: string, leadId: string, actorId?: string, kind: 'lead' | 'contact' = 'lead',
  options: { deferCustomerStatus?: boolean } = {}) {
  const scope = crmScope(tenantId);
  const lead = kind === 'lead' ? await tx.lead.findFirstOrThrow({ where: { id: leadId, ...scope } }) : await tx.contact.findFirstOrThrow({ where: { id: leadId, ...scope } });
  const productIds = kind === 'lead' && 'productInterestIds' in lead ? lead.productInterestIds : (await tx.contactProductInterest.findMany({ where: { tenantId, contactId: leadId, interested: true }, orderBy: { position: 'asc' } })).map(link => link.productInterestId);
  const selected = await tx.productInterest.findMany({ where: { tenantId, active: true, id: { in: productIds } } });
  if (!selected.length || lead.isArchived || kind === 'lead' && lead.convertedAt) return;
  await assertExternalCustomerEmail(tx, tenantId, lead.email, [kind === 'lead' ? 'leadIds' : 'contactIds']);
  const agent = lead.assignedUserId ? await tx.user.findFirst({ where: { tenantId, id: lead.assignedUserId }, select: { firstName: true, lastName: true } }) : undefined;
  const { pipeline, initial } = await salesPipeline(tx, tenantId);
  for (const product of selected) {
    const automationKey = `${kind === 'contact' ? 'contact:' : ''}${lead.id}:${product.id}`;
    const existing = await tx.deal.findFirst({ where: { ...scope, OR: [{ automationKey }, { ...(kind === 'lead' ? { leadDeals: { some: { tenantId, leadId: lead.id } } } : { contactDeals: { some: { tenantId, contactId: lead.id } } }), productInterestId: product.id }] } });
    if (existing) {
      if (!existing.assignedUserId && lead.assignedUserId && !existing.isArchived) {
        const updated = await tx.deal.update({ where: { id: existing.id, ...scope }, data: { assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId } });
        await fireDealUpdated({ tenantId, actorId, record: updated, changedFields: ['assignedUserId'] });
      }
      continue;
    }
    const deal = await runCrmAutomaticCreation(tx, 'deals', lead.assignedUserId, () => tx.deal.create({ data: { ...scope, automationKey, title: `${lead.firstName} ${lead.lastName} – ${product.name}`.slice(0, 255),
      productInterestId: product.id, productsNormalized: true, value: Number(product.dealValue), assignedUserId: lead.assignedUserId, ownerId: lead.assignedUserId,
      pipelineId: pipeline.id, stageId: initial.id, accountId: lead.accountId, leadSource: lead.source,
      ...(lead.attribution ? { attribution: lead.attribution as Prisma.InputJsonObject } : {}), tags: [] } }));
    if (kind === 'lead') await tx.leadDeal.create({ data: { ...scope, leadId: lead.id, dealId: deal.id, addedById: actorId } });
    else await tx.contactDeal.create({ data: { ...scope, contactId: lead.id, dealId: deal.id, addedById: actorId } });
    if (actorId) await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'deal.created', entityType: 'Deal', entityId: deal.id } });
    if (actorId || lead.assignedUserId) await tx.activity.create({ data: { ...scope, dealId: deal.id, createdById: (actorId ?? lead.assignedUserId)!,
      type: 'deal_action', title: `Deal created for ${product.name}; ${agent ? 'assigned to ' + agent.firstName + ' ' + agent.lastName : 'awaiting assignment'}`, description: `System created this Deal from the ${kind === 'lead' ? 'Lead' : 'Contact'}'s Product Interest.` } });
    await fireDealCreated({ tenantId, actorId, deal });
  }
  if (actorId && !options.deferCustomerStatus) await classifyCustomerRecord(tx, tenantId, kind === 'lead' ? { leadId } : { contactId: leadId }, actorId);
}

/** Shared transactional rotation for new CRM records. */
export async function resolveSalesAgent(tx: Tx, tenantId: string, assignedUserId?: string | null, modules: CrmModule[] = ['leads', 'deals']) {
  const agents = await eligibleAgents(tx, tenantId, modules);
  let agent = assignedUserId ? await validateSalesOwner(tx, tenantId, assignedUserId, modules) : undefined;
  if (!agent && agents.length) {
    const key = { tenantId, module: modules.includes('leads') ? 'lead-assignment' : `${modules[0]}-assignment`, key: 'default' };
    const cursor = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
    const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
    agent = modules.includes('leads') ? lowestWorkloadRotation(agents, await weightedLeadScores(tx, tenantId, agents.map(user => user.id)), lastId) : agents[(agents.findIndex(user => user.id === lastId) + 1) % agents.length];
    await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: agent!.id }, update: { value: agent!.id } });
  }
  return agent;
}

/** Public inquiries rotate exclusively through current eligible default Sales members. */
export async function resolveFormSalesAgent(tx: Tx, tenantId: string) {
  const group = await findSalesGroup(tx, tenantId);
  if (!group) return undefined;
  const members = new Set(group.members.map(member => member.userId));
  const agents = (await eligibleAgents(tx, tenantId)).filter(user => members.has(user.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!agents.length) return undefined;
  const key = { tenantId, module: 'form-lead-assignment', key: `sales:${group.id}` };
  const cursor = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
  const lastId = typeof cursor?.value === 'string' ? cursor.value : '';
  // A removed cursor member still has a stable position in the ordered pool.
  const agent = lowestWorkloadRotation(agents, await weightedLeadScores(tx, tenantId, agents.map(user => user.id)), lastId)!;
  await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: agent!.id }, update: { value: agent!.id } });
  return agent;
}

export async function createAssignedLead(tx: Tx, input: Prisma.LeadUncheckedCreateInput, actorId?: string, assignment: 'default' | 'public-form' = 'default') {
  await assertCrmCreateAssignment(tx, input.tenantId, input.assignedUserId, 'leads');
  const scope = crmScope(input.tenantId);
  if (input.creationKey) {
    const existing = await tx.lead.findFirst({ where: { ...scope, creationKey: input.creationKey } });
    if (existing) return existing;
  }
  await assertExternalCustomerEmail(tx, input.tenantId, input.email);
  await assertExternalCustomerPhone(tx, input.tenantId, input.phone);
  if (input.status === 'Closed Deal') throw new ValidationError('Confirm a related Deal as Closed Deal before closing this customer.');
  if (input.accountId && !await tx.account.findFirst({ where: { ...scope, id: input.accountId, isArchived: false, deletedAt: null } })) throw new ValidationError('Account is unavailable in this workspace.');
  // API callers provide IDs. Trusted imports may still provide historical names; resolve them here.
  const products = input.productInterestIds
    ? await resolveProducts(tx, scope.tenantId, input.productInterestIds as string[])
    : await tx.productInterest.findMany({ where: { tenantId: scope.tenantId, active: true, name: { in: (input.productInterest ?? []) as string[] } } });
  if (!input.productInterestIds && new Set((input.productInterest ?? []) as string[]).size !== products.length) throw new ValidationError('Unknown Product Interest');
  const relations = await productRelationData(tx, 'lead', scope.tenantId, { ids: products.map(p => p.id) });
  const lead = await runCrmAutomaticCreation(tx, 'leads', null, () => tx.lead.create({ data: { ...input, ...scope, ...relations, assignedUserId: null, manualCancellation: input.status === 'Cancelled', status: input.status ?? 'Inquiry' } }));
  const agent = assignment === 'public-form'
    ? await resolveFormSalesAgent(tx, scope.tenantId)
    : await resolveSalesAgent(tx, scope.tenantId, input.assignedUserId, ['leads', 'deals']);
  if (agent) {
    const score = (await weightedLeadScores(tx, scope.tenantId, [agent.id])).get(agent.id) ?? 0;
    await withAssignmentReason(tx, 'record_creation', () => tx.lead.update({ where: { id: lead.id, ...scope }, data: { assignedUserId: agent.id, updatedAt: lead.createdAt } }));
    await tx.activity.create({ data: { ...scope, leadId: lead.id, createdById: actorId ?? agent.id, type: 'assignment', metadata: { method: input.assignedUserId ? 'explicit' : 'weighted_workload', workloadScore: score, tieBreaker: 'round_robin' },
      title: `Lead assigned to ${agent.firstName} ${agent.lastName}`, description: assignment === 'public-form' ? 'Default Sales group weighted workload assignment; round-robin resolves ties.' : `${input.assignedUserId ? 'Explicit' : 'Weighted workload'} assignment.` } });
  } else if (actorId) {
    await tx.activity.create({ data: { ...scope, leadId: lead.id, createdById: actorId, type: 'assignment',
      title: 'Lead awaiting assignment', description: assignment === 'public-form' ? 'The default Sales group has no eligible active members. The inquiry was saved as Unassigned.' : 'No eligible active agents are available. The inquiry was saved as Unassigned.' } });
    await tx.auditLog.create({ data: { ...scope, userId: actorId, action: 'lead.assignment_unavailable', entityType: 'Lead', entityId: lead.id,
      changeset: { after: { assignedUserId: null, assignment: 'public-form', reason: 'sales_group_empty' } } } });
  }
  if (actorId) await tx.auditLog.create({ data: { ...scope, userId: actorId, action: 'lead.created', entityType: 'Lead', entityId: lead.id } });
  const assignedLead = await tx.lead.findFirstOrThrow({ where: { id: lead.id, ...scope }, include: { assignedUser: { select: { id: true, firstName: true, lastName: true } } } });
  await fireLeadCreated({ tenantId: scope.tenantId, actorId, lead: assignedLead });
  await createProductDeals(tx, scope.tenantId, lead.id, actorId);
  if (lead.status === 'Cancelled' && actorId) await cancelOpenDeals(tx, scope.tenantId, actorId, { leadId: lead.id }, 'Staff created a cancelled opportunity.');
  if (actorId) await classifyCustomerRecord(tx, scope.tenantId, { leadId: lead.id }, actorId);
  return { ...assignedLead, ...await tx.lead.findFirstOrThrow({ where: { id: lead.id, ...scope } }) };
}
