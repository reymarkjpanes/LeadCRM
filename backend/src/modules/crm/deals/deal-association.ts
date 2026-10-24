import type { Prisma } from '@prisma/client';
import { dealAssociationPatch, type DealAssociationChange } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';
import { ConflictError, ValidationError } from '../../../shared/errors/http-error';
import { assertCrmCreateAssignment, assertCrmRecordRead, crmActor, mayReadCrmModule, resolveCrmActor } from '../access/crm-record-access.service';
import { resolveSalesAgent, validateSalesOwner } from '../leads/lead-automation.service';

export async function readDealAssociation(tx: Prisma.TransactionClient, tenantId: string, association: Pick<DealAssociationChange, 'type' | 'id'>) {
  const module = association.type === 'lead' ? 'leads' : 'contacts';
  if (!await mayReadCrmModule(tx, tenantId, module)) throw new AppError(`You do not have permission to associate this ${association.type === 'lead' ? 'Lead' : 'Contact'}.`, 403);
  await assertCrmRecordRead(tx, module, association.id);
  const where = { tenantId, id: association.id, isArchived: false, deletedAt: null };
  const select = { id: true, assignedUserId: true, accountId: true };
  const record = association.type === 'lead' ? await tx.lead.findFirst({ where, select }) : await tx.contact.findFirst({ where, select });
  if (!record) throw new ValidationError(`The selected ${association.type === 'lead' ? 'Lead' : 'Contact'} is unavailable. Choose an active record in this workspace.`);
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
