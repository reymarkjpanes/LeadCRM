import type { Prisma } from '@prisma/client';
import { assertExternalCustomerEmail } from '../record-validation';
import { dealAssociationPatch, formatAssignmentChange, type DealAssociationChange } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';
import { ConflictError, ValidationError } from '../../../shared/errors/http-error';
import { assertCrmCreateAssignment, assertCrmRecordMutation, assertCrmRecordRead, authorizedWorkflowScope, crmActor, mayReadCrmModule, resolveCrmActor } from '../access/crm-record-access.service';
import { resolveSalesAgent, validateSalesOwner } from '../leads/lead-automation.service';
import { assignmentSnapshot } from '../../notifications/assignment-presentation';
import { writeAuditLog } from '../../../core/audit/audit.service';

/** Manual reassignment only; the caller holds the source lock in salesTransaction. */
export async function synchronizeAssociatedDealAssignment(tx: Prisma.TransactionClient, tenantId: string,
  source: { type: 'lead' | 'contact'; id: string; assignedUserId: string | null },
  assignedUserId: string | null | undefined, actorId?: string) {
  if (!actorId || !assignedUserId || assignedUserId === source.assignedUserId || authorizedWorkflowScope(tenantId)) return;
  await validateSalesOwner(tx, tenantId, assignedUserId, [source.type === 'lead' ? 'leads' : 'contacts', 'deals']);
  const read = async () => await tx.deal.findMany({
    where: { tenantId, isArchived: false, deletedAt: null, ...(source.type === 'lead'
      ? { leadDeals: { some: { tenantId, leadId: source.id } } }
      : { contactDeals: { some: { tenantId, contactId: source.id } } }) },
    orderBy: { id: 'asc' },
    select: { id: true, assignedUserId: true,
      leadDeals: { where: { tenantId }, select: { leadId: true, lead: { select: { contactId: true, convertedAt: true } } } },
      contactDeals: { where: { tenantId }, select: { contactId: true } },
    },
  });
  // Enumerate complete junctions even when an associated Deal is hidden. These
  // facts stay internal; every candidate must pass ordinary mutation authorization.
  const actor = crmActor.getStore();
  const deals = actor ? await crmActor.run({ ...actor, readRecords: false }, read) : await read();
  for (const deal of deals) {
    await assertCrmRecordMutation(tx, 'deals', deal.id, 'edit', { assignedUserId });
    const exclusive = source.type === 'lead'
      ? deal.contactDeals.length === 0 && deal.leadDeals.length === 1 && deal.leadDeals[0].leadId === source.id
      : deal.contactDeals.length === 1 && deal.contactDeals[0].contactId === source.id &&
        deal.leadDeals.every(link => link.lead.convertedAt && link.lead.contactId === source.id);
    if (!exclusive || deal.assignedUserId !== source.assignedUserId) {
      throw new ConflictError('Cannot synchronize Assigned Agent: an associated Deal is shared or independently assigned. Resolve its ownership or relationships before reassigning this record.');
    }
  }
  if (!deals.length) return;
  const assignment = await assignmentSnapshot(tx, tenantId, source.assignedUserId, assignedUserId, actorId);
  for (const deal of deals) {
    await tx.deal.update({ where: { tenantId, id: deal.id, isArchived: false, deletedAt: null, assignedUserId: source.assignedUserId }, data: { assignedUserId } });
    await writeAuditLog({ tenantId, userId: actorId, action: 'deal.updated', entityType: 'Deal', entityId: deal.id,
      before: { assignedUserId: source.assignedUserId }, after: { assignedUserId },
      metadata: { changedFields: ['assignedUserId'], source: `${source.type}_assignment`, sourceRecordId: source.id },
    }, tx);
    await tx.activity.create({ data: { tenantId, dealId: deal.id, createdById: actorId, type: 'assignment',
      ...formatAssignmentChange(assignment), metadata: { ...assignment, sourceType: source.type, sourceRecordId: source.id },
    } });
  }
  // Database triggers capture assignment notifications and CRM revisions. Do not
  // enqueue Deal workflows: this cascade must not start unrelated automation.
}

export async function readDealAssociation(tx: Prisma.TransactionClient, tenantId: string, association: Pick<DealAssociationChange, 'type' | 'id'>) {
  const module = association.type === 'lead' ? 'leads' : 'contacts';
  if (!await mayReadCrmModule(tx, tenantId, module)) throw new AppError(`You do not have permission to associate this ${association.type === 'lead' ? 'Lead' : 'Contact'}.`, 403);
  await assertCrmRecordRead(tx, module, association.id);
  const where = { tenantId, id: association.id, isArchived: false, deletedAt: null };
  const select = { id: true, assignedUserId: true, accountId: true, email: true };
  const record = association.type === 'lead' ? await tx.lead.findFirst({ where, select }) : await tx.contact.findFirst({ where, select });
  if (!record) throw new ValidationError(`The selected ${association.type === 'lead' ? 'Lead' : 'Contact'} is unavailable. Choose an active record in this workspace.`);
  await assertExternalCustomerEmail(tx, tenantId, record.email, [association.type === 'lead' ? 'leadIds' : 'contactIds']);
  return record;
}

/** Resolve only manual creation. Automatic product/Workflow creation retains its own policy. */
export async function resolveManualDealAssociation(tx: Prisma.TransactionClient, tenantId: string, input: {
  leadIds?: string[]; contactIds?: string[]; assignedUserId?: string; accountId?: string;
}) {
  if ((input.leadIds?.length ?? 0) + (input.contactIds?.length ?? 0) !== 1) throw new ValidationError('Select one Lead or Contact to associate with this Deal.');
  const record = await readDealAssociation(tx, tenantId, input.leadIds?.length ? { type: 'lead', id: input.leadIds[0] } : { type: 'contact', id: input.contactIds![0] });
  const actor = crmActor.getStore();
  const restricted = actor && (await resolveCrmActor(tx, actor)).assignmentRestricted;
  let agent;
  try {
    agent = record.assignedUserId
      ? await validateSalesOwner(tx, tenantId, record.assignedUserId, ['deals'])
      : restricted ? await validateSalesOwner(tx, tenantId, actor.userId, ['deals']) : await resolveSalesAgent(tx, tenantId, undefined, ['deals']);
  } catch (error) {
    if (error instanceof ValidationError) throw new ValidationError('The selected Lead or Contact needs an eligible Deal agent. Ask an administrator to correct its assignment.');
    throw error;
  }
  if (!agent) throw new ValidationError('No eligible Deal agent is available. Ask an administrator to assign the selected Lead or Contact.');
  await assertCrmCreateAssignment(tx, tenantId, agent.id, 'deals');
  if (input.assignedUserId && input.assignedUserId !== agent.id) throw new ValidationError('The initial Deal agent must match the selected Lead or Contact.');
  const account = record.accountId ? await tx.account.findFirst({ where: { tenantId, id: record.accountId, isArchived: false, deletedAt: null }, select: { id: true } }) : null;
  if (input.accountId && input.accountId !== account?.id) throw new ValidationError('The Deal Account must match the selected Lead or Contact’s linked Account.');
  return { assignedUserId: agent.id, accountId: account?.id };
}

/** Apply a targeted change to the existing junctions without replacing additional links. */
export function changeDealAssociation(leadIds: string[], contactIds: string[], change: DealAssociationChange) {
  const patch = dealAssociationPatch(leadIds, contactIds, change);
  if (!patch) throw new ConflictError('This Deal’s relationships changed. Reopen the form before changing its association.');
  return patch;
}
