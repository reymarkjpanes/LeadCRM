import { findTrigger, getWorkflowConditionFields, type WorkflowDraft, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { readConfiguredFields } from '../../crm/closing-requirements/closing-requirements.repository';
import { normalizeWorkflowReferences } from '@leadcrm/shared';

export const workflowCustomFields = (tenantId: string) => readConfiguredFields(prisma, tenantId);
export async function supportedChangedFields(entity: WorkflowEntity, fields: unknown, tenantId: string): Promise<string[]> {
  if (!Array.isArray(fields)) return [];
  const allowed = new Set(getWorkflowConditionFields(entity, undefined, await workflowCustomFields(tenantId)).map(f => f.field.slice(entity.length + 1)));
  const aliases: Record<string, string> = { productInterest: 'productInterestIds', productInterests: 'productInterestIds', productInterestId: 'productInterestIds', activeProducts: 'activeProductIds' };
  return [...new Set(fields.filter((field): field is string => typeof field === 'string').map(field => aliases[field] ?? field).filter(field => allowed.has(field)))];
}
export async function conditionFields(draft: WorkflowDraft, tenantId: string) {
  const trigger = findTrigger(draft.trigger);
  const custom = draft.conditions?.conditions.some(rule => rule.field.includes('.customFieldValues.'));
  return trigger ? getWorkflowConditionFields(trigger.entity, draft.trigger, custom ? await workflowCustomFields(tenantId) : []) : [];
}
/** Read adapter only. The next explicit save persists deterministic mappings; history is untouched. */
export async function compatibleWorkflow<T extends Pick<WorkflowDraft, 'trigger'> & { conditions?: unknown; actions?: unknown }>(draft: T, tenantId: string): Promise<T> {
  const products = /productInterest|activeProduct/.test(JSON.stringify([draft.conditions, draft.actions]))
    ? await prisma.productInterest.findMany({ where: { tenantId }, select: { id: true, name: true } }) : [];
  return normalizeWorkflowReferences(draft, products);
}
