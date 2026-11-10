import { parseStoredCrmStatus } from '@leadcrm/shared';
import { safeWorkflowError } from '../actions/action-dispatcher';
import { salesContext, communicationDealContext, discardWorkflowWake, workflowTransactionCommitted } from '../../crm/leads/sales-context';
import type { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { enqueueWorkflowTrigger, enqueueStageConditionContinuations } from '../workflows/workflow-queue';
interface RecordEvent { tenantId: string; actorId?: string; eventId?: string; originDealId?: string | null; }
interface ContactEvent extends RecordEvent { contact: { id: string; updatedAt?: Date; status: string; assignedUserId?: string | null; source?: string | null }; }
interface LeadEvent extends RecordEvent { lead: { id: string; updatedAt?: Date; status: string; score?: number | null; source?: string | null; assignedUserId?: string | null; companyName?: string | null }; }
interface DealEvent extends RecordEvent { deal: { id: string; title: string; value?: number | null; assignedUserId?: string | null }; }
interface UpdatedEvent extends RecordEvent { record: { id: string; updatedAt?: Date }; changedFields: string[]; changes?: { before: Record<string, unknown>; after: Record<string, unknown> }; }
async function fire(params: RecordEvent, type: string, entity: string, id: string, context: Record<string, unknown> = {}): Promise<void> {
  const record = 'lead' in params ? (params as LeadEvent).lead : 'contact' in params ? (params as ContactEvent).contact : 'record' in params ? (params as UpdatedEvent).record : undefined;
  const eventId = params.eventId ? `${type}:${params.eventId}` : (type.endsWith('.created') ? `${type}:${id}` : record?.updatedAt ? `${type}:${id}:${record.updatedAt.toISOString()}` : undefined);
  const originDealId = params.originDealId !== undefined ? params.originDealId : communicationDealContext.getStore();
  const event = { eventId, triggerType: type, entityType: entity, entityId: id, tenantId: params.tenantId, actorId: params.actorId, context: { ...context, ...(originDealId !== undefined ? { 'event.originDealId': originDealId } : {}) } };
  const tx = salesContext.getStore();
  // Required source-transaction events must roll back the source if enqueueing fails.
  const enqueue = async (client: Prisma.TransactionClient) => { await enqueueWorkflowTrigger(client, event); await enqueueStageConditionContinuations(client, event); };
  if (tx) { await enqueue(tx); return; }
  let transaction: Prisma.TransactionClient | undefined;
  try {
    await prisma.$transaction(client => { transaction = client; return enqueue(client); });
    if (transaction) workflowTransactionCommitted(transaction);
  }
  catch (error) {
    if (transaction) discardWorkflowWake(transaction);
    console.error('[Workflow] Event processing failed', { trigger: type, entityType: entity, entityId: id,
    tenantId: params.tenantId, eventId, failureClass: error instanceof Error ? error.name : 'UnknownError', message: safeWorkflowError(error) }); }
}
export function fireLeadCreated(params: LeadEvent) { return fire(params, 'lead.created', 'lead', params.lead.id); }
function statusEvent(previous: string, next: string) {
  const before = parseStoredCrmStatus(previous);
  const after = parseStoredCrmStatus(next);
  if (!before || !after || before === after) return undefined;
  return { 'event.previousStatus': before, 'event.newStatus': after };
}
export async function fireLeadStatusChanged(params: LeadEvent & { prevStatus: string }) {
  const context = statusEvent(params.prevStatus, params.lead.status);
  if (context) await fire(params, 'lead.status_changed', 'lead', params.lead.id, context);
}
export function fireContactCreated(params: ContactEvent) { return fire(params, 'contact.created', 'contact', params.contact.id); }
export async function fireContactStatusChanged(params: ContactEvent & { prevStatus: string }) {
  const context = statusEvent(params.prevStatus, params.contact.status);
  if (context) await fire(params, 'contact.status_changed', 'contact', params.contact.id, context);
}
export function fireDealCreated(params: DealEvent) { return fire(params, 'deal.created', 'deal', params.deal.id); }
async function updated(params: UpdatedEvent, entity: string) {
  if (!params.changedFields.length) return;
  await fire(params, `${entity}.updated`, entity, params.record.id, { 'event.changedFields': params.changedFields });
}
export const fireLeadUpdated = (params: UpdatedEvent) => updated(params, 'lead');
export const fireContactUpdated = (params: UpdatedEvent) => updated(params, 'contact');
export const fireDealUpdated = (params: UpdatedEvent) => updated(params, 'deal');
export const fireAccountUpdated = (params: UpdatedEvent) => updated(params, 'account');
export async function fireDealStageChanged(params: DealEvent & { newStageId: string; newStageName: string; isWon: boolean; isLost: boolean; prevStageId?: string }) {
  if (!params.prevStageId || params.newStageId === params.prevStageId) return;
  const context = { 'event.previousStageId': params.prevStageId, 'event.newStageId': params.newStageId,
    ...(params.eventId ? { 'event.stageHistoryId': params.eventId } : {}) };
  await fire(params, 'deal.stage_changed', 'deal', params.deal.id, context);
  if (params.isWon) await fire(params, 'deal.closed_won', 'deal', params.deal.id, context);
  else if (params.isLost) await fire(params, 'deal.closed_lost', 'deal', params.deal.id, context);
}
