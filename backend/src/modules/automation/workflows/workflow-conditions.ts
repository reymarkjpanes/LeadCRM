import { isWorkflowStatusField, parseStoredCrmStatus, validConditionScalar, WorkflowConditionSchema, type WorkflowCondition, type WorkflowConditionRule } from '@leadcrm/shared';

function conditionDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = value.slice(0, 10);
  if (!validConditionScalar('date', date)) return undefined;
  return value === date || value[10] === 'T' && Number.isFinite(Date.parse(value)) ? date : undefined;
}

/** Context is deliberately flat: dots are literal key characters, never traversal. */
export function evaluateRule(rule: WorkflowConditionRule, context: Record<string, unknown>): boolean {
  const stored = Object.prototype.hasOwnProperty.call(context, rule.field) ? context[rule.field] : undefined;
  // A record-only preview has no transition or change evidence to compare.
  if (rule.field.startsWith('event.') && stored === undefined) return false;
  const status = isWorkflowStatusField(rule.field);
  const date = rule.field === 'deal.expectedCloseDate' || rule.operator === 'before' || rule.operator === 'after';
  const actual = status ? parseStoredCrmStatus(stored) : date ? conditionDate(stored) : stored;
  const expected = status ? parseStoredCrmStatus(rule.value) : date ? conditionDate(rule.value) : rule.value;
  const empty = actual === null || actual === undefined || (typeof actual === 'string' && !actual.trim()) || (Array.isArray(actual) && actual.length === 0);
  if (rule.operator === 'is_empty') return empty;
  if (rule.operator === 'is_not_empty') return !empty;
  if (actual == null || expected == null || rule.incompleteValue) return false;
  // Blank values match only explicit, historically supported blank comparisons.
  if (typeof actual === 'string' && !actual.trim() && !(typeof expected === 'string' && !expected.trim())) return false;
  // An unverified history cannot prove a negative. Other OR branches can still match.
  if (rule.field === 'deal.hasEverBeenWon' && actual === false && context['deal.wonHistoryVerified'] !== true) return false;
  switch (rule.operator) {
    case 'equals':
    case 'not_equals': {
      if (typeof actual !== typeof expected || !['string', 'number', 'boolean'].includes(typeof actual) ||
          typeof actual === 'number' && !Number.isFinite(actual)) return false;
      return rule.operator === 'equals' ? actual === expected : actual !== expected;
    }
    case 'before': return typeof actual === 'string' && typeof expected === 'string' && actual < expected;
    case 'after': return typeof actual === 'string' && typeof expected === 'string' && actual > expected;
    case 'contains':
    case 'not_contains': {
      if (typeof expected !== 'string') return false;
      const contains = Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' ? actual.toLowerCase().includes(expected.toLowerCase()) : undefined;
      return contains !== undefined && (rule.operator === 'contains' ? contains : !contains);
    }
    case 'starts_with': return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'ends_with': return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    default: {
      if (typeof actual !== 'number' || typeof expected !== 'number' || !Number.isFinite(actual)) return false;
      if (rule.operator === 'greater_than') return actual > expected;
      if (rule.operator === 'less_than') return actual < expected;
      if (rule.operator === 'greater_than_or_equal') return actual >= expected;
      return rule.operator === 'less_than_or_equal' && actual <= expected;
    }
  }
}

export function evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>): boolean {
  const parsed = WorkflowConditionSchema.parse(condition);
  if (!parsed.conditions.length) return true;
  const results = parsed.conditions.map(rule => evaluateRule(rule, context));
  return parsed.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}
