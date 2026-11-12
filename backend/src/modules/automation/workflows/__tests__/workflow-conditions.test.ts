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
    ['before', '2026-01-01', '2026-01-02', true], ['after', '2026-01-02', '2026-01-01', true],
    ['before', '2026-01-02', '2026-01-02', false], ['after', '2026-01-02', '2026-01-02', false],
    ['equals', false, false, true], ['equals', 0, 0, true],
    ['contains', ['one', 'two'], 'two', true], ['not_contains', ['one'], 'two', true],
    ['greater_than', '12', 10, false], ['less_than', Number.NaN, 10, false],
    ['less_than', null, 1, false], ['equals', 1, '1', false],
  ];
  it.each(cases)('%s evaluates literal dotted keys (%s)', (operator, actual, value, expected) => {
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'fixture.value', operator, value }] },
      { 'fixture.value': actual })).toBe(expected);
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
  it.each([null, undefined, '', ' ', '\t\r\n', []])('treats %j as empty without failing All conditions', actual => {
    const context = actual === undefined ? {} : { 'deal.lostReason': actual };
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'deal.lostReason', operator: 'is_empty', value: null }] }, context)).toBe(true);
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'deal.lostReason', operator: 'is_not_empty', value: null }] }, context)).toBe(false);
  });
  it.each(['reason', '  reason  ', 0, false, ['value']])('does not confuse %j with empty', actual => {
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'deal.lostReason', operator: 'is_not_empty', value: null }] }, { 'deal.lostReason': actual })).toBe(true);
  });
  it('matches public relationship labels and preserved uppercase status conditions', () => {
    for (const [actual, value] of [['WARM', 'Warm'], ['Warm', 'WARM'], ['Closed Deal', 'CLOSED_DEAL']]) {
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value }] }, { 'contact.status': actual })).toBe(true);
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'not_equals', value }] }, { 'contact.status': actual })).toBe(false);
    }
  });
  it('does not accidentally accept nested contexts', () => {
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value: 'HOT' }] },
      { contact: { status: 'HOT' } })).toBe(false);
  });

  it('distinguishes missing event evidence from an explicitly empty event value', () => {
    const conditions = { operator: 'AND' as const, conditions: [{ field: 'event.changedFields', operator: 'is_empty' as const, value: null }] };
    expect(evaluateCondition(conditions, {})).toBe(false);
    expect(evaluateCondition(conditions, { 'event.changedFields': [] })).toBe(true);
  });

  it.each([null, '', '   ', 'unknown', 0, undefined])('never matches an unknown stored status (%j) by comparison', value => {
    for (const operator of ['equals', 'not_equals'] as const) {
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'deal.engagementStatus', operator, value: 'Warm' }] },
        { 'deal.engagementStatus': value, 'deal.stageId': 'Warm' })).toBe(false);
    }
  });

  it('honors other OR rules when history cannot establish that a Deal never won', () => {
    const conditions = [
      { field: 'deal.hasEverBeenWon', operator: 'equals' as const, value: false },
      { field: 'deal.priority', operator: 'equals' as const, value: 'HIGH' },
    ];
    const context = { 'deal.hasEverBeenWon': false, 'deal.wonHistoryVerified': false, 'deal.priority': 'HIGH' };
    expect(evaluateCondition({ operator: 'OR', conditions }, context)).toBe(true);
    expect(evaluateCondition({ operator: 'AND', conditions }, context)).toBe(false);
  });
});
