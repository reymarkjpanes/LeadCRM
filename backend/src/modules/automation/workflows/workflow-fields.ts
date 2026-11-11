import { findTrigger, getWorkflowConditionFields, customFieldTechnicalKey, resolveCustomFieldReference, WORKFLOW_MODULES, type WorkflowDraft, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { readConfiguredFields } from '../../crm/closing-requirements/closing-requirements.repository';
import { normalizeWorkflowReferences, WorkflowActionSchema, WorkflowConditionSchema, normalizeSavedWorkflowAssignment, retiredAccountWorkflowReferences, ACCOUNT_RETIREMENT_REASON, workflowDefinitionIssues } from '@leadcrm/shared';
import { workflowEmailContent } from '../actions/action-email-content';

export const workflowCustomFields = (tenantId: string, db: import('@prisma/client').Prisma.TransactionClient = prisma) => readConfiguredFields(db, tenantId);
/** Resolve only the template content actually used by each email action. Definitions remain unchanged. */
export async function accountWorkflowRetirementReferences(draft: { trigger: string; conditions?: unknown; actions?: unknown }, tenantId: string, db: import('@prisma/client').Prisma.TransactionClient = prisma) {
  const actions = Array.isArray(draft.actions) ? draft.actions : [];
  const ids = actions.flatMap(action => action?.type === 'send_email' && typeof action.config?.templateId === 'string' ? [action.config.templateId] : []);
  if (!ids.length) return retiredAccountWorkflowReferences(draft);
  const templates = await db.template.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, subject: true, content: true } });
  return retiredAccountWorkflowReferences({ ...draft, actions: actions.map(action => {
    const template = action?.type === 'send_email' && templates.find(template => template.id === action.config?.templateId);
    return template ? { ...action, config: { ...action.config, ...workflowEmailContent(action.config, template) } } : action;
  }) });
}
export async function supportedChangedFields(entity: WorkflowEntity, fields: unknown, tenantId: string): Promise<string[]> {
  if (!Array.isArray(fields)) return [];
  const definitions = await workflowCustomFields(tenantId);
  const allowed = new Set(getWorkflowConditionFields(entity, undefined, definitions).map(f => f.field.slice(entity.length + 1)));
  const aliases: Record<string, string> = { productInterest: 'productInterestIds', productInterests: 'productInterestIds', productInterestId: 'productInterestIds', activeProducts: 'activeProductIds' };
  return [...new Set(fields.filter((field): field is string => typeof field === 'string').map(field => {
    const custom = field.startsWith('customFieldValues.') && resolveCustomFieldReference(WORKFLOW_MODULES[entity], field, definitions);
    return custom ? `customFieldValues.${custom.id}` : aliases[field] ?? field;
  }).filter(field => allowed.has(field)))];
}
export async function conditionFields(draft: WorkflowDraft, tenantId: string) {
  const trigger = findTrigger(draft.trigger);
  const custom = draft.conditions?.conditions.some(rule => rule.field.includes('.customFieldValues.'));
  if (!trigger) return [];
  const definitions = custom ? await workflowCustomFields(tenantId) : [];
  const fields = getWorkflowConditionFields(trigger.entity, draft.trigger, definitions);
  return fields.flatMap(field => {
    const definition = definitions.find(item => item.id === field.customFieldId);
    const alias = definition && `${trigger.entity}.${customFieldTechnicalKey(definition)}`;
    return alias && alias !== field.field ? [field, { ...field, field: alias }] : [field];
  });
}
/** Read adapter only. The next explicit save persists deterministic mappings; history is untouched. */
export async function compatibleWorkflow<T extends Pick<WorkflowDraft, 'trigger'> & { conditions?: unknown; actions?: unknown; isActive?: boolean; status?: string }>(draft: T, tenantId: string, db: import('@prisma/client').Prisma.TransactionClient = prisma): Promise<T> {
  if ((await accountWorkflowRetirementReferences(draft, tenantId, db)).length) return { ...draft, isActive: false, status: draft.status === 'DRAFT' && !draft.isActive ? 'DRAFT' : 'PAUSED', repairReason: ACCOUNT_RETIREMENT_REASON };
  const serialized = JSON.stringify([draft.conditions, draft.actions]);
  const products = /productInterest|activeProduct/.test(serialized)
    ? await db.productInterest.findMany({ where: { tenantId }, select: { id: true, name: true } }) : [];
  const references = normalizeWorkflowReferences(draft, products);
  const normalized = { ...references, actions: Array.isArray(references.actions) ? references.actions.map(action => {
    const parsed = WorkflowActionSchema.safeParse(action);
    return parsed.success ? normalizeSavedWorkflowAssignment(parsed.data) : action;
  }) : references.actions };
  const entity = findTrigger(draft.trigger)?.entity;
  const conditions = WorkflowConditionSchema.safeParse(normalized.conditions);
  const policyIssues = workflowDefinitionIssues({ trigger: normalized.trigger, actions: Array.isArray(normalized.actions) ? normalized.actions.flatMap(action => {
    const parsed = WorkflowActionSchema.safeParse(action);
    return parsed.success ? [parsed.data] : [];
  }) : [], conditions: conditions.success ? conditions.data : undefined });
  if (policyIssues.length) Object.assign(normalized, { repairReason: policyIssues[0] });
  if (!entity || !serialized.includes('customFieldValues.')) return normalized;
  const definitions = await workflowCustomFields(tenantId, db);
  const canonical = (key: string) => {
    const field = resolveCustomFieldReference(WORKFLOW_MODULES[entity], key, definitions);
    return field ? `customFieldValues.${field.id}` : key;
  };
  const savedConditions = normalized.conditions as WorkflowDraft['conditions'];
  return { ...normalized,
    conditions: savedConditions && Array.isArray(savedConditions.conditions) ? { ...savedConditions, conditions: savedConditions.conditions.map(rule =>
      typeof rule?.field === 'string' && rule.field.startsWith(`${entity}.customFieldValues.`) ? { ...rule, field: `${entity}.${canonical(rule.field.slice(entity.length + 1))}` } : rule,
    ) } : normalized.conditions,
    actions: Array.isArray(normalized.actions) ? normalized.actions.map(action => action?.type === 'update_field' && typeof action.config?.field === 'string' && action.config.field.startsWith('customFieldValues.')
      ? { ...action, config: { ...action.config, field: canonical(action.config.field) } } : action) : normalized.actions,
  };
}
