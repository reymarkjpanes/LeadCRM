import { WorkflowConditionSchema, type WorkflowCondition, type WorkflowConditionRule } from '@leadcrm/shared';

/** Context is deliberately flat: dots are literal key characters, never traversal. */
export function evaluateRule(rule: WorkflowConditionRule, context: Record<string, unknown>): boolean {
  const actual = Object.prototype.hasOwnProperty.call(context, rule.field) ? context[rule.field] : undefined;
  const empty = actual === null || actual === undefined || (typeof actual === 'string' && !actual.trim()) || (Array.isArray(actual) && actual.length === 0);
  if (rule.operator === 'is_empty') return empty;
  if (rule.operator === 'is_not_empty') return !empty;
  if (actual === undefined) return false;
  // Contact stores uppercase enums; public CRM editors use canonical title case.
  if (['lead.status', 'contact.status'].includes(rule.field) && typeof actual === 'string' && typeof rule.value === 'string') {
    const equal = actual.trim().toLowerCase() === rule.value.trim().toLowerCase();
    if (rule.operator === 'equals') return equal;
    if (rule.operator === 'not_equals') return !equal;
  }
  switch (rule.operator) {
    case 'equals': return rule.field.endsWith('Date') && typeof actual === 'string' && typeof rule.value === 'string' ? actual.slice(0, 10) === rule.value : actual === rule.value;
    case 'before': return typeof actual === 'string' && typeof rule.value === 'string' && actual.slice(0, 10) < rule.value;
    case 'after': return typeof actual === 'string' && typeof rule.value === 'string' && actual.slice(0, 10) > rule.value;
    case 'not_equals': return actual !== rule.value;
    case 'contains': return Array.isArray(actual) ? actual.includes(rule.value) : typeof actual === 'string' && actual.toLowerCase().includes(String(rule.value).toLowerCase());
    case 'not_contains': return Array.isArray(actual) ? !actual.includes(rule.value) : typeof actual === 'string' && !actual.toLowerCase().includes(String(rule.value).toLowerCase());
    case 'starts_with': return typeof actual === 'string' && actual.startsWith(String(rule.value));
    case 'ends_with': return typeof actual === 'string' && actual.endsWith(String(rule.value));
    default: {
      if (empty || typeof actual !== 'number' || typeof rule.value !== 'number' || !Number.isFinite(actual)) return false;
      if (rule.operator === 'greater_than') return actual > rule.value;
      if (rule.operator === 'less_than') return actual < rule.value;
      if (rule.operator === 'greater_than_or_equal') return actual >= rule.value;
      return rule.operator === 'less_than_or_equal' && actual <= rule.value;
    }
  }
}

export function evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>): boolean {
  const parsed = WorkflowConditionSchema.parse(condition);
  if (!parsed.conditions.length) return true;
  const results = parsed.conditions.map(rule => evaluateRule(rule, context));
  return parsed.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}
