import { describe, expect, it } from 'vitest';
import { getWorkflowConditionFields, type WorkflowConditionOperator, type WorkflowField } from '@leadcrm/shared';
import { evaluateCondition as evaluateTypedCondition, evaluateRule } from '../workflow-conditions';

const fields = [
  ...getWorkflowConditionFields('deal', 'deal.updated'),
  ...getWorkflowConditionFields('deal', 'deal.stage_changed'),
  ...getWorkflowConditionFields('contact', 'contact.status_changed'),
];
const evaluateCondition = (condition: Parameters<typeof evaluateTypedCondition>[0], context: Record<string, unknown>) =>
  evaluateTypedCondition(condition, context, fields);
const fixtureField = (type: WorkflowField['type']): WorkflowField => ({ field: 'fixture.value', label: 'Fixture', type });
const fixtureRule = (type: WorkflowField['type'], operator: WorkflowConditionOperator, actual: unknown, value: string | number | boolean | null) =>
  evaluateRule({ field: 'fixture.value', operator, value }, { 'fixture.value': actual }, fixtureField(type));

describe('typed flat workflow conditions', () => {
  const cases: [WorkflowField['type'], WorkflowConditionOperator, unknown, string | number | boolean | null, boolean][] = [
    ['string', 'equals', 'HOT', 'hot', true], ['string', 'not_equals', 'WARM', 'hot', true],
    ['number', 'greater_than', 100001, 100000, true], ['number', 'less_than', 2, 3, true],
    ['number', 'greater_than_or_equal', 3, 3, true], ['number', 'less_than_or_equal', 3, 3, true],
    ['string', 'contains', 'Facebook Ads', 'BOOK', true], ['string', 'not_contains', 'Referral', 'book', true],
    ['string', 'starts_with', 'Facebook', 'face', true], ['string', 'ends_with', 'Facebook', 'BOOK', true],
    ['string', 'is_empty', null, null, true], ['string', 'is_not_empty', 'HOT', null, true],
    ['date', 'before', '2026-01-01', '2026-01-02', true], ['date', 'after', '2026-01-02', '2026-01-01', true],
    ['date', 'before', '2026-01-02', '2026-01-02', false], ['date', 'after', '2026-01-02', '2026-01-02', false],
    ['boolean', 'equals', false, false, true], ['number', 'equals', 0, 0, true],
    ['products', 'contains', ['one', 'two'], 'two', true], ['products', 'not_contains', ['one'], 'two', true],
    ['number', 'greater_than', '12', 10, false], ['number', 'less_than', Number.NaN, 10, false],
    ['number', 'less_than', null, 1, false], ['number', 'equals', 1, '1', false],
  ];
  it.each(cases)('%s %s evaluates literal dotted keys (%s)', (type, operator, actual, value, expected) => {
    expect(fixtureRule(type, operator, actual, value)).toBe(expected);
  });

  it.each(['equals', 'contains', 'starts_with', 'ends_with'] as const)('ignores Unicode letter case for text %s', operator => {
    expect(fixtureRule('string', operator, 'ÉCOLE', 'école')).toBe(true);
    expect(fixtureRule('string', operator, '東京', '東京')).toBe(true);
  });

  it('preserves whitespace, punctuation, and accents in text operands', () => {
    expect(fixtureRule('string', 'equals', ' Manila ', 'manila')).toBe(false);
    expect(fixtureRule('string', 'equals', 'José', 'Jose')).toBe(false);
    expect(fixtureRule('string', 'contains', 'North-East', 'north east')).toBe(false);
    expect(fixtureRule('string', 'starts_with', ' Manila', 'manila')).toBe(false);
  });

  it.each(['enum', 'user', 'pipeline', 'stage', 'account'] as const)('preserves exact %s identity', type => {
    expect(fixtureRule(type, 'equals', 'AbC', 'abc')).toBe(false);
    expect(fixtureRule(type, 'not_equals', 'AbC', 'abc')).toBe(true);
    expect(fixtureRule(type, 'equals', 'AbC', 'AbC')).toBe(true);
  });

  it.each(['products', 'contacts', 'leads', 'list'] as const)('uses exact membership for %s collections', type => {
    expect(fixtureRule(type, 'contains', ['AbC'], 'abc')).toBe(false);
    expect(fixtureRule(type, 'not_contains', ['AbC'], 'abc')).toBe(true);
    expect(fixtureRule(type, 'contains', ['AbC'], 'AbC')).toBe(true);
    expect(fixtureRule(type, 'contains', ['AbC', 1], 'AbC')).toBe(false);
    expect(fixtureRule(type, 'is_empty', [], null)).toBe(true);
    expect(fixtureRule(type, 'is_not_empty', ['AbC'], null)).toBe(true);
    expect(fixtureRule(type, 'not_contains', [], 'AbC')).toBe(false);
  });

  it.each([null, undefined, '', ' ', '\t\r\n'])('treats %j as empty and excludes negative text comparisons', actual => {
    expect(fixtureRule('string', 'is_empty', actual, null)).toBe(true);
    expect(fixtureRule('string', 'is_not_empty', actual, null)).toBe(false);
    expect(fixtureRule('string', 'not_equals', actual, 'value')).toBe(false);
    expect(fixtureRule('string', 'not_contains', actual, 'value')).toBe(false);
  });

  it('preserves explicit historical blank equality without accepting incomplete or negative blank matches', () => {
    expect(fixtureRule('string', 'equals', '', '')).toBe(true);
    expect(fixtureRule('string', 'equals', ' ', ' ')).toBe(true);
    expect(fixtureRule('string', 'equals', ' ', '')).toBe(false);
    expect(fixtureRule('string', 'not_equals', ' ', '')).toBe(false);
    expect(evaluateRule({ field: 'fixture.value', operator: 'equals', value: '', incompleteValue: true },
      { 'fixture.value': '' }, fixtureField('string'))).toBe(false);
  });

  it.each([
    ['number', 'equals', Number.POSITIVE_INFINITY, 1], ['number', 'equals', 1, Number.POSITIVE_INFINITY],
    ['number', 'greater_than', 1, Number.NaN], ['number', 'not_equals', '0', 0],
    ['boolean', 'not_equals', 'false', false], ['string', 'not_equals', 0, '0'],
    ['string', 'is_not_empty', ['value'], null], ['string', 'is_empty', [], null],
    ['date', 'not_equals', 'not-a-date', '2026-01-01'], ['date', 'is_not_empty', '2026-02-31', null],
  ] as const)('rejects malformed %s values for %s', (type, operator, actual, value) => {
    expect(fixtureRule(type, operator, actual, value)).toBe(false);
  });

  it.each([
    ['number', 'contains', 12, '1'], ['boolean', 'is_empty', null, null],
    ['enum', 'starts_with', 'HIGH', 'H'], ['products', 'equals', ['id'], 'id'],
    ['string', 'before', '2026-01-01', '2026-01-02'],
  ] as const)('rejects an operator unavailable for %s: %s', (type, operator, actual, value) => {
    expect(fixtureRule(type, operator, actual, value)).toBe(false);
  });

  it('compares standard and custom date metadata by the same canonical calendar day', () => {
    for (const key of ['deal.expectedCloseDate', 'deal.customFieldValues.inspection-date']) {
      const field: WorkflowField = { field: key, label: 'Date', type: 'date' };
      const context = { [key]: '2026-09-25T10:00:00.000Z' };
      expect(evaluateRule({ field: key, operator: 'equals', value: '2026-09-25' }, context, field)).toBe(true);
      expect(evaluateRule({ field: key, operator: 'not_equals', value: '2026-09-25' }, context, field)).toBe(false);
      expect(evaluateRule({ field: key, operator: 'before', value: '2026-09-26' }, context, field)).toBe(true);
      expect(evaluateRule({ field: key, operator: 'after', value: '2026-09-24' }, context, field)).toBe(true);
      expect(evaluateRule({ field: key, operator: 'equals', value: '2026-09-26' },
        { [key]: '2026-09-25T23:30:00-02:00' }, field)).toBe(true);
      expect(evaluateRule({ field: key, operator: 'is_empty', value: null }, { [key]: null }, field)).toBe(true);
    }
    expect(fixtureRule('date', 'equals', '2028-02-29', '2028-02-29')).toBe(true);
    expect(fixtureRule('date', 'equals', '2026-02-29', '2026-03-01')).toBe(false);
    expect(fixtureRule('date', 'equals', '2026-01-01T10:00:00', '2026-01-01')).toBe(false);
  });

  it('does not treat zero or false as missing or coerce their types', () => {
    expect(fixtureRule('number', 'equals', 0, 0)).toBe(true);
    expect(fixtureRule('number', 'not_equals', 0, 1)).toBe(true);
    expect(fixtureRule('boolean', 'equals', false, false)).toBe(true);
    expect(fixtureRule('boolean', 'not_equals', false, true)).toBe(true);
    expect(fixtureRule('boolean', 'equals', false, 'false')).toBe(false);
  });

  it('evaluates AND and OR and treats an empty gate as all matching records', () => {
    const conditions = [
      { field: 'deal.value', operator: 'greater_than' as const, value: 100000 },
      { field: 'deal.title', operator: 'equals' as const, value: 'Other' },
    ];
    const context = { 'deal.value': 150000, 'deal.title': 'Proposal' };
    expect(evaluateCondition({ operator: 'AND', conditions }, context)).toBe(false);
    expect(evaluateCondition({ operator: 'OR', conditions }, context)).toBe(true);
    for (const operator of ['AND', 'OR'] as const) expect(evaluateTypedCondition({ operator, conditions: [] }, {})).toBe(true);
  });

  it.each([
    ['qualified', '', true], ['contacted', '', true], ['other', 'Customer cancelled', true],
    ['qualified', 'Customer cancelled', true], ['other', '', false], ['other', '   ', false],
  ])('evaluates three alternative conditions for stage %s and reason %j', (stage, reason, expected) => {
    const conditions = [
      { field: 'deal.stageId', operator: 'equals' as const, value: 'qualified' },
      { field: 'deal.stageId', operator: 'equals' as const, value: 'contacted' },
      { field: 'deal.lostReason', operator: 'is_not_empty' as const, value: null },
    ];
    const context = { 'deal.stageId': stage, 'deal.lostReason': reason };
    expect(evaluateCondition({ operator: 'OR', conditions }, context)).toBe(expected);
    expect(evaluateCondition({ operator: 'AND', conditions }, context)).toBe(false);
  });

  it('matches public relationship labels and preserved uppercase status conditions', () => {
    for (const [actual, value] of [['WARM', 'Warm'], ['Warm', 'WARM'], ['Closed Deal', 'CLOSED_DEAL']]) {
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value }] }, { 'contact.status': actual })).toBe(true);
      expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'contact.status', operator: 'not_equals', value }] }, { 'contact.status': actual })).toBe(false);
    }
  });

  it('requires declared metadata and never traverses nested or prototype keys', () => {
    const rule = { field: 'fixture.value', operator: 'equals' as const, value: 'match' };
    expect(evaluateRule(rule, { 'fixture.value': 'match' })).toBe(false);
    expect(evaluateRule(rule, { 'fixture.value': 'match' }, { ...fixtureField('string'), field: 'other' })).toBe(false);
    expect(evaluateRule(rule, { fixture: { value: 'match' } }, fixtureField('string'))).toBe(false);
    expect(evaluateRule(rule, Object.create({ 'fixture.value': 'match' }), fixtureField('string'))).toBe(false);
  });

  it('distinguishes missing event evidence from an explicitly empty event value', () => {
    for (const operator of ['is_empty', 'is_not_empty', 'not_contains'] as const) {
      const conditions = { operator: 'AND' as const, conditions: [{ field: 'event.changedFields', operator, value: operator === 'not_contains' ? 'title' : null }] };
      expect(evaluateCondition(conditions, {})).toBe(false);
    }
    expect(evaluateCondition({ operator: 'AND', conditions: [{ field: 'event.changedFields', operator: 'is_empty', value: null }] }, { 'event.changedFields': [] })).toBe(true);
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
