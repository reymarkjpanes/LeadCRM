import { workflowOperators, type WorkflowDraft } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { AppError } from '../../../shared/errors/app-error';
import { findTrigger } from '../triggers/trigger-catalog';
import { validateAction } from '../actions/action-validation';
import * as refs from '../actions/actions.repository';
import { z } from 'zod';

export function validateWorkflowConditions(draft: WorkflowDraft): void {
  const trigger = findTrigger(draft.trigger);
  if (!trigger) throw new ValidationError('Choose a supported trigger.');
  if (!draft.name.trim()) throw new ValidationError('Enter a workflow name.');
  for (const rule of draft.conditions?.conditions ?? []) {
    const field = trigger.fields.find(entry => entry.field === rule.field);
    if (!field) throw new ValidationError(`Choose a condition field available for ${trigger.label}.`);
    if (!workflowOperators(field.type).includes(rule.operator)) throw new ValidationError(`Choose a supported operator for ${field.label}.`);
    if (['is_empty', 'is_not_empty'].includes(rule.operator)) continue;
    const valueType = field.type === 'number' || field.type === 'boolean' ? field.type : 'string';
    if (typeof rule.value !== valueType) throw new ValidationError(`${field.label} requires a ${valueType} value.`);
    if (typeof rule.value === 'string' && (rule.value.length > 1000 || /[\x00-\x1f\x7f]/.test(rule.value))) throw new ValidationError('Condition value contains unsupported characters or is too long.');
    if (field.options && !field.options.includes(String(rule.value))) throw new ValidationError(`Choose a supported ${field.label}.`);
    if (['user', 'stage', 'pipeline'].includes(field.type) && !z.string().uuid().safeParse(rule.value).success) throw new ValidationError(`Choose a valid ${field.label}.`);
    if (field.type === 'date' && (typeof rule.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rule.value) || Number.isNaN(Date.parse(rule.value)) || new Date(rule.value).toISOString().slice(0, 10) !== rule.value)) throw new ValidationError('Choose a valid date.');
  }
}

export async function validateConditionReferences(draft: WorkflowDraft, tenantId: string): Promise<void> {
  validateWorkflowConditions(draft);
  const trigger = findTrigger(draft.trigger)!;
  for (const rule of draft.conditions?.conditions ?? []) {
    if (['is_empty', 'is_not_empty'].includes(rule.operator)) continue;
    const field = trigger.fields.find(field => field.field === rule.field)!;
    if (field.type === 'user' && !await refs.findUser(String(rule.value), tenantId)) throw new ValidationError('Condition agent is unavailable.');
    if (field.type === 'stage' && !await refs.findStage(String(rule.value), tenantId)) throw new ValidationError('Condition stage is unavailable.');
    if (field.type === 'pipeline' && !await refs.findPipeline(String(rule.value), tenantId)) throw new ValidationError('Condition pipeline is unavailable.');
    if (field.type === 'account' && !await refs.findAccount(String(rule.value), tenantId)) throw new ValidationError('Condition account is unavailable.');
  }
}

export async function validateWorkflow(draft: WorkflowDraft, tenantId: string): Promise<void> {
  await validateConditionReferences(draft, tenantId);
  const trigger = findTrigger(draft.trigger)!;
  if (!draft.actions.some(action => action.enabled !== false)) throw new ValidationError('Enable at least one action before activating.');
  for (const [index, action] of draft.actions.entries()) {
    try { await validateAction(action, trigger.entity, tenantId); }
    catch (error) {
      if (!(error instanceof AppError)) throw error;
      throw new ValidationError(`Action ${index + 1}: ${error.message}`);
    }
  }
}

