import { isWorkflowStatusField, parseStoredCrmStatus, validConditionScalar, workflowOperators, WorkflowConditionSchema, type WorkflowCondition, type WorkflowConditionRule, type WorkflowField } from '@leadcrm/shared';

function conditionDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = value.slice(0, 10);
  if (!validConditionScalar('date', date)) return undefined;
  if (value === date) return date;
  // Match the repository's UTC calendar-day projection, independent of host timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

const collectionTypes = new Set<WorkflowField['type']>(['products', 'contacts', 'leads', 'list']);

function validStoredValue(field: WorkflowField, value: unknown): boolean {
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (collectionTypes.has(field.type)) return Array.isArray(value) && value.every(item => typeof item === 'string');
  return typeof value === 'string';
}

/** Context is deliberately flat: dots are literal key characters, never traversal. */
export function evaluateRule(rule: WorkflowConditionRule, context: Record<string, unknown>, field?: WorkflowField): boolean {
  if (!field || field.field !== rule.field || !workflowOperators(field.type).includes(rule.operator)) return false;
  const stored = Object.prototype.hasOwnProperty.call(context, rule.field) ? context[rule.field] : undefined;
  // A record-only preview has no transition or change evidence to compare.
  if (rule.field.startsWith('event.') && stored === undefined) return false;
  if (stored == null) return rule.operator === 'is_empty';
  if (!validStoredValue(field, stored)) return false;
  const empty = typeof stored === 'string' && !stored.trim() || Array.isArray(stored) && stored.length === 0;
  if (empty) {
    if (rule.operator === 'is_empty') return true;
    // Existing unmarked literal blank equality remains readable/executable. New
    // incomplete operands and every negative comparison exclude empty records.
    return rule.operator === 'equals' && field.type === 'string' && !rule.incompleteValue &&
      typeof rule.value === 'string' && !rule.value.trim() && stored === rule.value;
  }
  const status = isWorkflowStatusField(rule.field);
  const date = field.type === 'date';
  const actual = status ? parseStoredCrmStatus(stored) : date ? conditionDate(stored) : stored;
  // A nonempty invalid date/status is malformed, not an empty or known value.
  if (actual === undefined) return false;
  if (rule.operator === 'is_empty') return false;
  if (rule.operator === 'is_not_empty') return true;
  if (rule.incompleteValue) return false;
  const expectedType = field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string';
  if (typeof rule.value !== expectedType || typeof rule.value === 'number' && !Number.isFinite(rule.value)) return false;
  const expected = status ? parseStoredCrmStatus(rule.value) : date ? conditionDate(rule.value) : rule.value;
  if (expected == null || field.options && !field.options.includes(String(expected))) return false;
  // An unverified history cannot prove a negative. Other OR branches can still match.
  if (rule.field === 'deal.hasEverBeenWon' && actual === false && context['deal.wonHistoryVerified'] !== true) return false;
  switch (rule.operator) {
    case 'equals':
    case 'not_equals': {
      if (typeof actual !== typeof expected || !['string', 'number', 'boolean'].includes(typeof actual) ||
          typeof actual === 'number' && !Number.isFinite(actual)) return false;
      const equal = field.type === 'string' && typeof actual === 'string' && typeof expected === 'string'
        ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
      return rule.operator === 'equals' ? equal : !equal;
    }
    case 'before': return typeof actual === 'string' && typeof expected === 'string' && actual < expected;
    case 'after': return typeof actual === 'string' && typeof expected === 'string' && actual > expected;
    case 'contains':
    case 'not_contains': {
      if (typeof expected !== 'string') return false;
      const contains = Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' ? actual.toLowerCase().includes(expected.toLowerCase()) : undefined;
      return contains !== undefined && (rule.operator === 'contains' ? contains : !contains);
    }
    case 'starts_with': return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().startsWith(expected.toLowerCase());
    case 'ends_with': return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().endsWith(expected.toLowerCase());
    default: {
      if (typeof actual !== 'number' || typeof expected !== 'number' || !Number.isFinite(actual)) return false;
      if (rule.operator === 'greater_than') return actual > expected;
      if (rule.operator === 'less_than') return actual < expected;
      if (rule.operator === 'greater_than_or_equal') return actual >= expected;
      return rule.operator === 'less_than_or_equal' && actual <= expected;
    }
  }
}

export function evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>, fields: readonly WorkflowField[] = []): boolean {
  const parsed = WorkflowConditionSchema.parse(condition);
  if (!parsed.conditions.length) return true;
  const results = parsed.conditions.map(rule => evaluateRule(rule, context, fields.find(field => field.field === rule.field)));
  return parsed.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}
