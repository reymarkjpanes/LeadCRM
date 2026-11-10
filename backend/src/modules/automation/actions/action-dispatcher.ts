import { resolveDealTargets, relatedDealMoveGuard } from './action-deal-targets';
import { type WorkflowAction } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';
import { ValidationError } from '../../../shared/errors/http-error';
import { sendEmail } from '../../../integrations/gmail/gmail.service';
import * as repo from './actions.repository';
import { actionEntity, validateAction } from './action-validation';
import { assignmentPurpose, parseAssignment, resolveWorkflowAssignee, completeWorkflowAssignment, assignmentOutput } from '../assignment/workflow-assignment.service';
import { createTask } from '../../operations/tasks/tasks.service';
import { resolveTaskDealIds, workflowTaskAssociationSummary } from './action-task-deals';
import { prepareWorkflowTaskInput, restoredWorkflowTaskInput } from './action-task-input';
import { assertCurrentStageEntry, isSupersededStageEntry } from '../workflows/workflow-stage-entry';
import { normalizeSmsPhone, sendSms, SmsSubmissionError } from '../../../shared/services/sms.service';
import { fenceWorkflowLease, isWorkflowLeaseLost, workflowLeaseWrite } from '../workflows/workflow-lease';
import { prepareWorkflowSmsInput } from './action-sms';
import { fieldUpdatePatch } from './action-fields';
import { updateCompany } from '../../crm/companies/companies.service';
import { createActivity } from '../../crm/activities/activities.service';
import { moveDealStage, updateDeal } from '../../crm/deals/deals.service';
import { workflowLossReason } from '@leadcrm/shared';
import { updateContact as updateLead } from '../../crm/contacts/contacts.service';
import { updateContact as updateClientProfile } from '../../crm/contacts-v2/contacts-v2.service';

import { prepareWorkflowEmailInput } from './action-email';
import prisma from '../../../config/database.config';
import { salesTransaction } from '../../crm/leads/lead-automation.service';
import { isWorkflowAdmissionSkipped } from '../workflows/workflow-admission';
import { isStaleWorkflowAction, skipStaleWorkflowAction, type DealStageEvidence, type WorkflowActionGuard } from '../workflows/workflow-freshness';
import { lockWorkflowCrmRecord } from '../../crm/access/crm-record-access.service';
import { mailboxAddress } from '../../../integrations/gmail/mailbox-scope';

export type ActionResult = { success: boolean; skipped?: true; output?: Record<string, unknown>; error?: string;
  sourceChanges?: Record<string, unknown>; movedStages?: DealStageEvidence[] };
const actionSkipped = (error: unknown): error is AppError => isSupersededStageEntry(error) || isWorkflowAdmissionSkipped(error) || isStaleWorkflowAction(error);
export function safeWorkflowError(error: unknown): string {
  return error instanceof AppError ? error.message : 'The action could not complete. Check the record and integration, then try again.';
}
export async function dispatchAction(action: WorkflowAction, context: Record<string, unknown>, tenantId: string, actorId: string, execution?: { workflowId: string; actionIndex: number; stepId?: string; stageHistoryId?: string; guard?: WorkflowActionGuard }): Promise<ActionResult> {
  let assignment: Awaited<ReturnType<typeof resolveWorkflowAssignee>> | undefined;
  let restoredAssignment: Record<string, unknown> = {};
  let knownResult: ActionResult | undefined;
  let smsAttempted = false;
  const guard = execution?.guard;
  try {
    const entity = actionEntity(context);
    if (execution?.stageHistoryId) await assertCurrentStageEntry(tenantId, String(context['deal.id']), execution.stageHistoryId);
    // Stage moves validate the current target after its freshness guard, in the same CRM transaction.
    await validateAction(action, entity, tenantId, action.type === 'move_deal_stage' && guard ? undefined : context);
    const config = action.config;
    const entityId = String(context[`${entity}.id`]);
    const savedTaskStep = action.type === 'create_task' && execution?.stepId ? await prisma.workflowExecutionStep.findFirst({
      where: { id: execution.stepId, tenantId, actionType: 'create_task', execution: { workflowId: execution.workflowId } },
      select: { resolvedInput: true, output: true },
    }) : null;
    const savedTaskInput = savedTaskStep && execution?.stepId ? restoredWorkflowTaskInput(savedTaskStep.resolvedInput, execution.stepId) : undefined;
    assignment = ['create_task', 'assign_owner'].includes(action.type) ? await resolveWorkflowAssignee({
      tenantId, target: savedTaskInput ? { type: 'user', id: savedTaskInput.assignedUserId } : parseAssignment(action), purpose: assignmentPurpose(action),
      recordOwnerId: context[`${entity}.assignedUserId`] as string | undefined, entity, entityId, ...execution,
    }) : undefined;
    if (action.type === 'create_task') {
      const previous = savedTaskStep?.output as Record<string, unknown> | null;
      if (savedTaskInput && previous && previous.resolvedUserId === savedTaskInput.assignedUserId) {
        restoredAssignment = Object.fromEntries(['assignmentTargetType', 'assignmentTargetId', 'assignmentTargetName', 'candidateCount', 'strategy', 'reason', 'workload', 'capacityLimit']
          .flatMap(key => previous[key] !== undefined ? [[key, previous[key]]] : []));
      }
      const taskInput = savedTaskInput ?? await prepareWorkflowTaskInput({ action, entity, tenantId, context, assignedUserId: assignment!.resolvedUserId, requestId: execution?.stepId });
      const assigned = { ...assignmentOutput(assignment!), ...restoredAssignment };
      if (execution?.stepId && !savedTaskInput) await workflowLeaseWrite(tx => tx.workflowExecutionStep.update({ where: { id: execution.stepId, tenantId }, data: {
        resolvedInput: JSON.parse(JSON.stringify(taskInput)), output: JSON.parse(JSON.stringify(assigned)),
      } }));
      const task = await createTask(tenantId, actorId, taskInput,
        async client => {
          await guard?.admit(client, { preparedInput: true });
          if (execution?.stageHistoryId) await assertCurrentStageEntry(tenantId, String(context['deal.id']), execution.stageHistoryId, client);
          return resolveTaskDealIds(action, entity, tenantId, context, client);
        });
      const dealIds = task.dealLinks.map(link => link.dealId);
      const deals = task.dealLinks.map(link => ({ id: link.dealId, title: link.deal.title }));
      knownResult = { success: true, output: { taskId: task.id, dealIds, deals, taskCount: 1, dealCount: dealIds.length,
        associationSummary: workflowTaskAssociationSummary(dealIds.length), ...assigned } };
      return knownResult;
    }
    if (action.type === 'send_sms') {
      const { phone, message, recipientId } = await prepareWorkflowSmsInput(action, entity, tenantId, context);
      if (execution?.stepId) await workflowLeaseWrite(tx => tx.workflowExecutionStep.update({ where: { id: execution.stepId, tenantId }, data: { resolvedInput: { version: 1, phone, message, recipientId } } }));
      await fenceWorkflowLease();
      smsAttempted = true;
      const recipientEntity = entity === 'lead' || config.recipient === 'primary_lead' ? 'lead' : 'contact';
      const receipt = await sendSms(phone, message, { beforeProviderWrite: () => admitDelivery(guard, tenantId, recipientEntity, recipientId, { phone }) });
      return { success: true, output: { ...receipt, recipientId, status: 'submitted' } };
    }
    if (action.type === 'send_email') return { success: true, output: await deliverEmail(action, context, tenantId, execution?.stepId, guard) };
    if (action.type === 'move_deal_stage') {
      const ids = await resolveDealTargets(action, entity, tenantId, context);
      const relatedGuard = ids.length ? await relatedDealMoveGuard(action, entity, tenantId, context) : undefined;
      const movedDealIds: string[] = [];
      const movedStages: DealStageEvidence[] = [];
      const sourceChanges: Record<string, unknown> = {};
      for (const id of ids) {
        try {
          const { result, changes } = await salesTransaction(async tx => {
            const before = await guard?.admit(tx, { dealId: id, ownChanges: sourceChanges });
            const result = await moveDealStage(id, tenantId, actorId, { stageId: String(config.stageId), lostReason: workflowLossReason(config) }, relatedGuard, { optionalLossReason: true });
            return { result, changes: before && await guard?.changes(tx, before) };
          });
          Object.assign(sourceChanges, changes);
          if (result.stageHistory) {
            movedDealIds.push(id);
            const { pipelineId, stageId, currentStageHistoryId } = result.deal;
            movedStages.push({ id, pipelineId, stageId, currentStageHistoryId });
          }
        } catch (error) {
          if (isWorkflowLeaseLost(error)) throw error;
          if (actionSkipped(error)) return { success: false, skipped: true, output: { reason: error.message, movedDealIds, failedDealId: id, matchedDealIds: ids } };
          return { success: false, error: safeWorkflowError(error), output: { movedDealIds, failedDealId: id, matchedDealIds: ids } };
        }
      }
      if (!ids.length && guard) await workflowLeaseWrite(tx => guard.admit(tx));
      return { success: true, sourceChanges, movedStages, output: { matchedDealIds: ids, movedDealIds, stageId: config.stageId, unchanged: !movedDealIds.length, ...(ids.length ? {} : { reason: 'No related Deals matched.' }) } };
    }
    if (!['assign_owner', 'update_field'].includes(action.type)) throw new ValidationError('This action is no longer available.');
    const update = action.type === 'assign_owner' ? { assignedUserId: assignment!.resolvedUserId } : await fieldUpdatePatch(action, entity, tenantId);
    const sourceChanges = await salesTransaction(async tx => {
      const before = await guard?.admit(tx, { preparedInput: action.type === 'assign_owner' && parseAssignment(action).type === 'record_owner' });
      if (entity === 'deal') await updateDeal(entityId, tenantId, actorId, update);
      else if (entity === 'lead') await updateLead(entityId, tenantId, actorId, update);
      else if (entity === 'contact') await updateClientProfile(entityId, tenantId, update, actorId);
      else await updateCompany(entityId, tenantId, actorId, update);
      await createActivity(tenantId, actorId, { type: 'workflow', title: action.type === 'assign_owner' ? 'Workflow assigned agent' : 'Workflow updated record fields',
        ...(entity === 'lead' ? { leadId: entityId } : entity === 'contact' ? { contactId: entityId } : entity === 'account' ? { accountId: entityId } : { dealId: entityId }) });
      return before && await guard?.changes(tx, before);
    });
    knownResult = { success: true, sourceChanges, output: { entityId, updatedFields: Object.keys(update), ...(assignment ? assignmentOutput(assignment) : {}) } };
    return knownResult;
  } catch (error) { if (isWorkflowLeaseLost(error)) throw error;
    if (actionSkipped(error)) return { success: false, skipped: true, output: { reason: error.message } };
    return { success: false, error: safeWorkflowError(error), ...(error instanceof AppError && error.code === 'GMAIL_OUTCOME_UNKNOWN' || error instanceof SmsSubmissionError && error.outcome === 'unconfirmed' || smsAttempted && (!(error instanceof AppError) || error.statusCode >= 500) ? { output: { outcomeUnknown: true } } : assignment ? { output: { ...assignmentOutput(assignment), ...restoredAssignment } } : {}) }; }
  finally { if (assignment) try { await completeWorkflowAssignment(tenantId, assignment); }
    catch { if (knownResult) knownResult.output = { ...knownResult.output, assignmentCleanupPending: true,
      cleanupWarning: 'The action was saved. Assignment capacity cleanup is pending; its temporary reservation will expire.' }; }
  }
}
async function admitDelivery(guard: WorkflowActionGuard | undefined, tenantId: string, entity: 'lead' | 'contact', id: string,
  address: { email: string } | { phone: string }): Promise<void> {
  if (!guard) return fenceWorkflowLease();
  await prisma.$transaction(async tx => {
    await fenceWorkflowLease(tx);
    await guard.admit(tx, { preparedInput: true });
    if (!await lockWorkflowCrmRecord(tx, entity === 'lead' ? 'leads' : 'contacts', tenantId, id)) skipStaleWorkflowAction('The selected recipient is no longer available.');
    const where = { tenantId, id, isArchived: false, deletedAt: null };
    const record = entity === 'lead' ? await tx.lead.findFirst({ where: { ...where, convertedAt: null }, select: { email: true, phone: true } })
      : await tx.contact.findFirst({ where: { ...where, doNotContact: false }, select: { email: true, phone: true } });
    if (!record || ('email' in address ? mailboxAddress(record.email ?? '') !== address.email : !matchesPhone(record.phone, address.phone))) {
      skipStaleWorkflowAction('The selected recipient changed before submission.');
    }
  }, { timeout: 20000 });
}
function matchesPhone(current: string | null, expected: string) {
  try { return normalizeSmsPhone(current) === expected; } catch { return false; }
}

async function deliverEmail(action: WorkflowAction, context: Record<string, unknown>, tenantId: string, stepId?: string, guard?: WorkflowActionGuard): Promise<Record<string, unknown>> {
  const entity = actionEntity(context);
  const { senderId, senderEmail, recipient, recipientEntity, recipientId, subject, body, warnings } = await prepareWorkflowEmailInput(action, entity, tenantId, context);
  const messageId = stepId ? `<workflow-${stepId}@leadcrm.local>` : undefined;
  if (stepId) await workflowLeaseWrite(tx => tx.workflowExecutionStep.update({ where: { id: stepId, tenantId }, data: { resolvedInput: { version: 1, senderId, recipient, subject, body, messageId } } }));
  const log = await workflowLeaseWrite(async tx => {
    const log = await repo.createDelivery({ tenantId, fromEmail: senderEmail, toEmail: recipient, subject,
      ...(recipientEntity === 'lead' ? { leadId: recipientId } : { contactId: recipientId }) }, tx);
    if (stepId) await tx.workflowExecutionStep.update({ where: { id: stepId, tenantId }, data: { resolvedInput: { version: 1, senderId, recipient, subject, body, messageId, deliveryLogId: log.id } } });
    return log;
  });
  let sent: Awaited<ReturnType<typeof sendEmail>>;
  try {
    await fenceWorkflowLease();
    sent = await sendEmail(tenantId, senderId, recipient, subject, body, undefined, undefined, undefined, { messageId,
      beforeProviderWrite: () => admitDelivery(guard, tenantId, recipientEntity, recipientId, { email: recipient }) });
  } catch (error) {
    if (isWorkflowLeaseLost(error)) throw error;
    if (actionSkipped(error)) {
      await repo.finishDelivery(log.id, tenantId, { status: 'failed', errorMessage: error.message });
      throw error;
    }
    if (error instanceof AppError && error.code === 'GMAIL_OUTCOME_UNKNOWN') {
      await repo.finishDelivery(log.id, tenantId, { status: 'uncertain', errorMessage: 'Delivery outcome requires review before any replay.' });
      throw error;
    }
    await repo.finishDelivery(log.id, tenantId, { status: 'failed', errorMessage: 'Gmail delivery failed. Check the sender connection.' });
    throw new ValidationError('Gmail delivery failed. Check the sender connection.');
  }
  try {
    await repo.finishDelivery(log.id, tenantId, { status: 'sent', gmailMessageId: sent.messageId, gmailThreadId: sent.threadId, sentAt: new Date() });
  } catch (error) {
    if (isWorkflowLeaseLost(error)) throw error;
    throw new AppError('Gmail accepted the message, but its receipt could not be saved. Check Gmail before sending again.', 503, 'GMAIL_OUTCOME_UNKNOWN');
  }
  return { deliveryLogId: log.id, messageId: sent.messageId, status: 'sent', ...(warnings.length ? { warnings } : {}) };
}

