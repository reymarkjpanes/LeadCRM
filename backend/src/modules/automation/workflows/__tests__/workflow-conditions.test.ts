import { describe, expect, it, vi } from 'vitest';
import type { WorkflowConditionOperator } from '@leadcrm/shared';
vi.mock('../../../../config/database.config', () => ({ default: {} }));
import { evaluateCondition } from '../workflow.engine';

describe('canonical flat workflow context', () => {
  const cases: [WorkflowConditionOperator, unknown, string | number | boolean | null, boolean][] = [
    ['equals', 'HOT', 'HOT', true], ['not_equals', 'WARM', 'HOT', true],
    ['greater_than', 100001, 100000, true], ['less_than', 2, 3, true],
    ['greater_than_or_equal', 3, 3, true], ['less_than_or_equal', 3, 3, true],
    ['contains', 'Facebook Ads', 'book', true], ['not_contains', 'Referral', 'book', true],
    ['starts_with', 'Facebook', 'Face', true], ['ends_with', 'Facebook', 'book', true],
    ['is_empty', null, null, true], ['is_not_empty', 'HOT', null, true],
    ['less_than', null, 1, false], ['equals', 1, '1', false],
  ];
  it.each(cases)('%s evaluates literal dotted keys (%s)', (operator, actual, value, expected) => {
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator, value }] },
      { 'contact.status': actual })).toBe(expected);
  });
  it('evaluates AND and OR', () => {
    const conditions = [
      { field: 'deal.value', operator: 'greater_than' as const, value: 100000 },
      { field: 'deal.title', operator: 'equals' as const, value: 'Other' },
    ];
    const context = { 'deal.value': 150000, 'deal.title': 'Proposal' };
    expect(evaluateCondition({ operator: 'AND', conditions }, context)).toBe(false);
    expect(evaluateCondition({ operator: 'OR', conditions }, context)).toBe(true);
  });
  it('matches public relationship labels and preserved uppercase status conditions', () => {
    for (const [actual, value] of [['WARM', 'Warm'], ['Warm', 'WARM'], ['Closed', 'CLOSED']]) {
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value }] }, { 'contact.status': actual })).toBe(true);
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'not_equals', value }] }, { 'contact.status': actual })).toBe(false);
    }
  });
  it('does not accidentally accept nested contexts', () => {
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value: 'HOT' }] },
      { contact: { status: 'HOT' } })).toBe(false);
  });
});
