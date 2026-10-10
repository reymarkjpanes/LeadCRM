import { resolveDealTargets } from './action-deal-targets';
import { WORKFLOW_MESSAGE_VARIABLES, EmailSubjectSchema, type WorkflowAction } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';
import { ValidationError } from '../../../shared/errors/http-error';
import { sendEmail } from '../../../integrations/gmail/gmail.service';
import * as repo from './actions.repository';
import { actionEntity, validateAction } from './action-validation';
import { assignmentPurpose, parseAssignment, resolveWorkflowAssignee, completeWorkflowAssignment, assignmentOutput } from '../assignment/workflow-assignment.service';
import { createTask } from '../../operations/tasks/tasks.service';
import { sendSms } from '../../../shared/services/sms.service';
import { smsRecipient } from './action-sms';
import { fieldUpdatePatch } from './action-fields';
import { updateCompany } from '../../crm/companies/companies.service';
import { createActivity } from '../../crm/activities/activities.service';
import { moveDealStage, updateDeal } from '../../crm/deals/deals.service';
import { updateContact as updateLead } from '../../crm/contacts/contacts.service';
import { updateContact as updateClientProfile } from '../../crm/contacts-v2/contacts-v2.service';

import { sanitizeCampaignHtml } from '../../marketing/campaigns/campaign-content';

type ActionResult = { success: boolean; output?: Record<string, unknown>; error?: string };
export function safeWorkflowError(error: unknown): string {
  return error instanceof AppError ? error.message : 'The action could not complete. Check the record and integration, then try again.';
}
export async function dispatchAction(action: WorkflowAction, context: Record<string, unknown>, tenantId: string, actorId: string, execution?: { workflowId: string; actionIndex: number }): Promise<ActionResult> {
  let assignment: Awaited<ReturnType<typeof resolveWorkflowAssignee>> | undefined;
  let assignmentCommitted = false;
  try {
    const entity = actionEntity(context);
    await validateAction(action, entity, tenantId, context);
    const config = action.config;
    const entityId = String(context[`${entity}.id`]);
    assignment = ['create_task', 'assign_owner'].includes(action.type) ? await resolveWorkflowAssignee({
      tenantId, target: parseAssignment(action), purpose: assignmentPurpose(action),
      recordOwnerId: context[`${entity}.assignedUserId`] as string | undefined, entity, entityId, ...execution,
    }) : undefined;
    if (action.type === 'create_task') {
      const task = await createTask(tenantId, actorId, { title: render(String(config.title).trim(), context, entity, false), description: config.description ? render(String(config.description).trim(), context, entity, false) : undefined,
        priority: (config.priority || 'Medium') as 'Low' | 'Medium' | 'High', status: 'pending',
        dueDate: new Date(Date.now() + (typeof config.dueDaysFromNow === 'number' ? config.dueDaysFromNow : 3) * 86400000).toISOString(),
        assignedUserId: assignment!.resolvedUserId,
        ...(entity === 'lead' ? { leadId: entityId } : entity === 'contact' ? { contactId: entityId } : entity === 'account' ? { accountId: entityId } : { dealId: entityId }) });
      assignmentCommitted = true;
      return { success: true, output: { taskId: task.id, ...assignmentOutput(assignment!) } };
    }
    if (action.type === 'send_sms') {
      const recipient = await smsRecipient(action, entity, tenantId, context);
      const receipt = await sendSms(recipient.phone, render(String(config.message), { ...context, ...recipient.context }, entity, false));
      return { success: true, output: { ...receipt, recipientId: recipient.id, status: 'submitted' } };
    }
    if (action.type === 'send_email') return { success: true, output: await deliverEmail(action, context, tenantId) };
    if (action.type === 'move_deal_stage') {
      const ids = await resolveDealTargets(action, entity, tenantId, context);
      const movedDealIds: string[] = [];
      for (const id of ids) {
        try {
          const result = await moveDealStage(id, tenantId, actorId, { stageId: String(config.stageId), lostReason: config.lostReason ? String(config.lostReason) : undefined });
          if (result.stageHistory) movedDealIds.push(id);
        } catch (error) {
          return { success: false, error: safeWorkflowError(error), output: { movedDealIds, failedDealId: id, matchedDealIds: ids } };
        }
      }
      return { success: true, output: { matchedDealIds: ids, movedDealIds, stageId: config.stageId, unchanged: !movedDealIds.length, ...(ids.length ? {} : { reason: 'No related Deals matched.' }) } };
    }
    if (!['assign_owner', 'update_field'].includes(action.type)) throw new ValidationError('This action is no longer available.');
    const update = action.type === 'assign_owner' ? { assignedUserId: assignment!.resolvedUserId } : await fieldUpdatePatch(action, entity, tenantId);
    if (entity === 'deal') {
      await updateDeal(entityId, tenantId, actorId, update);
    } else if (entity === 'lead') {
      await updateLead(entityId, tenantId, actorId, update);
    } else if (entity === 'contact') {
      await updateClientProfile(entityId, tenantId, update, actorId);
    } else {
      await updateCompany(entityId, tenantId, actorId, update);
    }
    assignmentCommitted = action.type === 'assign_owner';
    await createActivity(tenantId, actorId, { type: 'workflow', title: action.type === 'assign_owner' ? 'Workflow assigned agent' : 'Workflow updated record fields',
      ...(entity === 'lead' ? { leadId: entityId } : entity === 'contact' ? { contactId: entityId } : entity === 'account' ? { accountId: entityId } : { dealId: entityId }) });
    return { success: true, output: { entityId, updatedFields: Object.keys(update), ...(assignment ? assignmentOutput(assignment) : {}) } };
  } catch (error) { return { success: false, error: safeWorkflowError(error), ...(assignment ? { output: assignmentOutput(assignment) } : {}) }; }
  finally { if (assignment) await completeWorkflowAssignment(tenantId, assignment, assignmentCommitted); }
}
function render(content: string, context: Record<string, unknown>, entity: string, html = true): string {
  const values: Record<string, unknown> = Object.fromEntries(WORKFLOW_MESSAGE_VARIABLES.map(variable => [variable.token,
    variable.fields.map(field => context[`${entity}.${field}`]).find(value => typeof value === 'string' || typeof value === 'number') ?? '']));
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => (html ? String(values[key] ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) : String(values[key] ?? '').replace(/[\x00-\x1f\x7f]/g, ' ')));
}
async function deliverEmail(action: WorkflowAction, context: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
  const entity = actionEntity(context);
  const senderId = String(action.config.senderUserId);
  const [template, sender] = await Promise.all([action.config.templateId ? repo.findTemplate(String(action.config.templateId), tenantId) : Promise.resolve(null), repo.findSender(senderId, tenantId)]);
  if ((action.config.templateId && !template) || !sender) throw new ValidationError('Reconnect the sender and choose an available email template.');
  const recipient = String(context[`${entity}.email`]);
  const subject = EmailSubjectSchema.parse(render(String(action.config.subject || template?.subject || ''), context, entity, false));
  const log = await repo.createDelivery({ tenantId, fromEmail: sender.email, toEmail: recipient, subject,
    ...(entity === 'lead' ? { leadId: String(context['lead.id']) } : { contactId: String(context['contact.id']) }) });
  let sent: Awaited<ReturnType<typeof sendEmail>>;
  try {
    sent = await sendEmail(tenantId, senderId, recipient, subject, sanitizeCampaignHtml(render(String(action.config.body || template?.content || ''), context, entity)));
  } catch {
    await repo.finishDelivery(log.id, tenantId, { status: 'failed', errorMessage: 'Gmail delivery failed. Check the sender connection.' });
    throw new ValidationError('Gmail delivery failed. Check the sender connection.');
  }
  try {
    await repo.finishDelivery(log.id, tenantId, { status: 'sent', gmailMessageId: sent.messageId, gmailThreadId: sent.threadId, sentAt: new Date() });
  } catch {
    throw new ValidationError('Gmail accepted the message, but its receipt could not be saved. Check Gmail before sending again.');
  }
  return { deliveryLogId: log.id, messageId: sent.messageId, status: 'sent' };
}

