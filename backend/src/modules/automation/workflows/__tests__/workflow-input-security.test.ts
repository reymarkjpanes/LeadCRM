import { describe, expect, it } from 'vitest';
import { WorkflowDraftSchema, workflowOperators, type WorkflowDraft } from '@leadcrm/shared';
import { validateWorkflowConditions } from '../workflow-validation';
import { evaluateRule } from '../workflow-conditions';
const draft: WorkflowDraft = { name: 'Follow up', trigger: 'deal.created', actions: [], isActive: false };
describe('workflow input security', () => {
  it.each(['\u0000Name', 'Name\r\n', '\tName'])('rejects control characters in names', name => {
    expect(WorkflowDraftSchema.safeParse({...draft,name}).success).toBe(false);
  });
  it('preserves legitimate Unicode and trims names', () => {
    expect(WorkflowDraftSchema.parse({...draft,name:'  José — 営業  '}).name).toBe('José — 営業');
  });
  it.each([
    {field:'deal.password',operator:'equals',value:'secret'},
    {field:'deal.priority',operator:'contains',value:'HIGH'},
    {field:'deal.priority',operator:'equals',value:'ADMIN'},
    {field:'deal.value',operator:'contains',value:'10'},
    {field:'deal.expectedCloseDate',operator:'before',value:'2026-02-31'},
    {field:'deal.stageId',operator:'equals',value:'not-an-id'},
  ])('rejects an invalid field, operator, value or reference format: $field', rule => {
    expect(() => validateWorkflowConditions({...draft,conditions:{operator:'AND',conditions:[rule as any]}})).toThrow();
  });
  it('compares dates by calendar day and exposes only date operators', () => {
    expect(workflowOperators('date')).toEqual(['equals','not_equals','before','after','is_empty','is_not_empty']);
    expect(evaluateRule({field:'deal.expectedCloseDate',operator:'equals',value:'2026-09-25'},{'deal.expectedCloseDate':'2026-09-25T10:00:00.000Z'})).toBe(true);
    expect(evaluateRule({field:'deal.expectedCloseDate',operator:'before',value:'2026-09-26'},{'deal.expectedCloseDate':'2026-09-25T10:00:00.000Z'})).toBe(true);
  });
});
