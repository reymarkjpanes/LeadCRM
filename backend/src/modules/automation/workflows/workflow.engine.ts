/**
 * Workflow Execution Engine
 *
 * Evaluates WorkflowCondition JSON as pure data — NEVER eval()'d as code.
 * Dispatches WorkflowAction steps and records execution history.
 */

import prisma from '../../../config/database.config';
import * as repo from './workflows.repository';

// ─────────────────────────────────────────────────────
// Types (mirrors shared/contracts/workflow.contracts.ts)
// ─────────────────────────────────────────────────────

interface WorkflowConditionRule {
  field:    string;
  operator: string;
  value:    string | number | boolean | null;
}

interface WorkflowCondition {
  operator:   'AND' | 'OR';
  conditions: WorkflowConditionRule[];
}

interface WorkflowAction {
  type:   string;
  config: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────
// Condition Evaluator
// ─────────────────────────────────────────────────────

/**
 * Safely evaluate a WorkflowCondition against a context object.
 * Pure data evaluation — no eval(), no dynamic code execution.
 */
export function evaluateCondition(
  condition: WorkflowCondition,
  context: Record<string, unknown>,
): boolean {
  const results = condition.conditions.map((rule: WorkflowConditionRule) => evaluateRule(rule, context));
  return condition.operator === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function evaluateRule(
  rule: WorkflowConditionRule,
  context: Record<string, unknown>,
): boolean {
  const fieldValue = resolveField(rule.field, context);

  switch (rule.operator) {
    case 'equals':             return fieldValue == rule.value;
    case 'not_equals':         return fieldValue != rule.value;
    case 'greater_than':       return Number(fieldValue) > Number(rule.value);
    case 'less_than':          return Number(fieldValue) < Number(rule.value);
    case 'greater_than_or_equal': return Number(fieldValue) >= Number(rule.value);
    case 'less_than_or_equal': return Number(fieldValue) <= Number(rule.value);
    case 'contains':           return String(fieldValue ?? '').toLowerCase().includes(String(rule.value).toLowerCase());
    case 'not_contains':       return !String(fieldValue ?? '').toLowerCase().includes(String(rule.value).toLowerCase());
    case 'starts_with':        return String(fieldValue ?? '').startsWith(String(rule.value));
    case 'ends_with':          return String(fieldValue ?? '').endsWith(String(rule.value));
    case 'is_empty':           return fieldValue == null || fieldValue === '';
    case 'is_not_empty':       return fieldValue != null && fieldValue !== '';
    default:                   return false;
  }
}

/** Resolve a dot-notation field path against a context object */
function resolveField(fieldPath: string, context: Record<string, unknown>): unknown {
  return fieldPath.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
    return undefined;
  }, context);
}

// ─────────────────────────────────────────────────────
// Action Dispatcher
// ─────────────────────────────────────────────────────

type ActionResult = { success: boolean; output?: object; error?: string };

async function dispatchAction(
  action: WorkflowAction,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'create_task':
        return await actionCreateTask(action.config, context, tenantId);
      case 'create_notification':
        return await actionCreateNotification(action.config, context, tenantId);
      case 'update_field':
        return await actionUpdateField(action.config, context, tenantId);
      case 'send_email':
        // Email sending is handled by the Gmail integration — log intent here
        return { success: true, output: { queued: true, type: 'send_email' } };
      case 'assign_owner':
        return await actionAssignOwner(action.config, context, tenantId);
      case 'move_deal_stage':
        return await actionMoveDealStage(action.config, context, tenantId);
      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function actionCreateTask(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const assignedUserId = String(config.assignedUserId ?? context['deal.assignedUserId'] ?? context['contact.assignedUserId'] ?? '');
  if (!assignedUserId) return { success: false, error: 'assignedUserId required for create_task action' };

  const task = await prisma.task.create({
    data: {
      tenantId,
      title:          String(config.title ?? 'Workflow Task'),
      description:    config.description ? String(config.description) : undefined,
      status:         'pending',
      priority:       String(config.priority ?? 'Medium'),
      dueDate:        new Date(Date.now() + Number(config.dueDaysFromNow ?? 3) * 86400000),
      assignedUserId,
      dealId:         context['deal.id']     ? String(context['deal.id'])     : undefined,
      leadId:         context['contact.id']  ? String(context['contact.id'])  : undefined,
    },
  });
  return { success: true, output: { taskId: task.id } };
}

async function actionCreateNotification(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const userId = String(config.userId ?? context['deal.assignedUserId'] ?? context['contact.assignedUserId'] ?? '');
  if (!userId) return { success: false, error: 'userId required for create_notification action' };

  const notification = await prisma.notification.create({
    data: {
      tenantId,
      userId,
      type:       String(config.type ?? 'workflow_triggered'),
      title:      String(config.title ?? 'Workflow notification'),
      body:       config.body ? String(config.body) : undefined,
      entityType: config.entityType ? String(config.entityType) : undefined,
      entityId:   config.entityId   ? String(config.entityId)   : undefined,
    },
  });
  return { success: true, output: { notificationId: notification.id } };
}

async function actionUpdateField(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const { entity, field, value } = config as { entity: string; field: string; value: unknown };
  const entityId = context[`${entity}.id`] ? String(context[`${entity}.id`]) : undefined;
  if (!entityId) return { success: false, error: `No ${entity}.id in context` };

  if (entity === 'contact') {
    await prisma.lead.update({ where: { id: entityId, tenantId }, data: { [field]: value } as never });
  } else if (entity === 'deal') {
    await prisma.deal.update({ where: { id: entityId, tenantId }, data: { [field]: value } });
  }
  return { success: true, output: { updated: { [field]: value } } };
}

async function actionAssignOwner(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const newOwnerId = String(config.userId ?? '');
  if (!newOwnerId) return { success: false, error: 'userId required for assign_owner action' };

  const dealId = context['deal.id'] ? String(context['deal.id']) : undefined;
  if (dealId) {
    await prisma.deal.update({ where: { id: dealId, tenantId }, data: { assignedUserId: newOwnerId } });
  }
  return { success: true, output: { assignedUserId: newOwnerId } };
}

async function actionMoveDealStage(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const dealId   = context['deal.id'] ? String(context['deal.id']) : undefined;
  const stageId  = String(config.stageId ?? '');
  if (!dealId || !stageId) return { success: false, error: 'deal.id and stageId required' };

  const stage = await prisma.stage.findFirst({ where: { id: stageId, tenantId } });
  if (!stage) return { success: false, error: 'Stage not found' };

  await prisma.deal.update({
    where: { id: dealId, tenantId },
    data: {
      stageId,
      ...(stage.isWon || stage.isLost ? { closedAt: new Date() } : {}),
    },
  });
  return { success: true, output: { newStageId: stageId } };
}

// ─────────────────────────────────────────────────────
// Main: Execute a Workflow
// ─────────────────────────────────────────────────────

export interface WorkflowFireParams {
  triggerType: string;
  entityType:  string;
  entityId:    string;
  tenantId:    string;
  context:     Record<string, unknown>; // flattened entity data for condition evaluation
}

/**
 * Find all active workflows matching the trigger, evaluate conditions,
 * and execute matching workflows. Records full execution history.
 */
export async function fireWorkflowTrigger(params: WorkflowFireParams): Promise<void> {
  const { triggerType, entityType, entityId, tenantId, context } = params;

  // Find workflows matching this trigger type for this tenant
  const workflows = await prisma.workflow.findMany({
    where: { tenantId, trigger: triggerType, isActive: true, isArchived: false },
  });

  for (const workflow of workflows) {
    // Evaluate conditions if present — skip workflow if conditions not met
    if (workflow.conditions) {
      const conditions = workflow.conditions as unknown as WorkflowCondition;
      try {
        const matches = evaluateCondition(conditions, context);
        if (!matches) continue;
      } catch {
        continue; // Malformed conditions — skip silently
      }
    }

    // Record the trigger
    const triggerRecord = await repo.recordTrigger({
      tenantId, workflowId: workflow.id, triggerType,
      entityType, entityId, payload: context as object,
    });

    // Create execution run
    const run = await repo.createExecutionRun({
      tenantId, workflowId: workflow.id, triggerId: triggerRecord.id,
      entityType, entityId,
    });

    // Execute each action step
    const actions = (workflow.actions as unknown) as WorkflowAction[];
    let overallStatus = 'completed';

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const result = await dispatchAction(action, context, tenantId);

      await repo.createExecutionStep({
        tenantId,
        executionId: run.id,
        stepIndex:   i,
        actionType:  action.type,
        status:      result.success ? 'success' : 'failed',
        output:      result.output,
        error:       result.error,
      });

      if (!result.success) {
        overallStatus = 'failed';
        break; // Stop on first failure (configurable in future)
      }
    }

    // Finalize the run
    await repo.updateExecutionRun(run.id, {
      status:      overallStatus,
      completedAt: new Date(),
    });
  }
}
