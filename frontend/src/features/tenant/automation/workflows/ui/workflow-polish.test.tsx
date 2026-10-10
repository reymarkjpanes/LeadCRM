import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS, missingWorkflowConditionValues, type WorkflowCondition, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import { ActionFields, ConditionFields } from './workflow-fields';
import { duplicateWorkflowName, workflowNameIssue } from '../services/workflow-editor';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES, QUALIFIED_FOLLOW_UP_NAME } from '../services/workflow-recipes';
const options = { users: [], pipelines: [], templates: [], campaigns: [], productInterests: [{ id: 'others', name: 'Others' }] };

function ConditionsEditor() {
  const [conditions, setConditions] = useState<WorkflowCondition>({ operator: 'AND', conditions: [
    { field: 'deal.title', operator: 'equals', value: 'First' },
    { field: 'deal.title', operator: 'equals', value: 'Middle' },
    { field: 'deal.title', operator: 'equals', value: 'Last' },
  ] });
  return <><ConditionFields options={options} trigger={WORKFLOW_TRIGGERS.find(t => t.type === 'deal.created')} value={conditions} onChange={setConditions} /><output data-testid="conditions">{JSON.stringify(conditions)}</output></>;
}
afterEach(cleanup);
function Editor({ entity, config }: { entity: WorkflowEntity; config: Record<string, unknown> }) {
  const [action, setAction] = useState<WorkflowAction>({ type: 'update_field', config });
  return <><ActionFields action={action} entity={entity} options={options} onChange={config => setAction({ ...action, config })} /><output data-testid="config">{JSON.stringify(action.config)}</output></>;
}
describe('workflow polish controls', () => {
  it.each([1, 2, 3])('removes only condition %s, renumbers and keeps the delete button beside its heading', index => {
    render(<ConditionsEditor />);
    const remove = screen.getByRole('button', { name: `Remove condition ${index}` });
    expect(remove.parentElement?.textContent).toBe(`Condition ${index}`);
    expect(remove.className).toContain('text-destructive');
    const field = screen.getByLabelText('Condition 1 field');
    expect(field.getAttribute('aria-required')).toBe('true');
    expect(field.closest('label')?.querySelector('.text-red-500')?.textContent).toBe('*');
    expect(screen.getByLabelText('Condition 1 value').closest('label')?.querySelector('.text-red-500')?.textContent).toBe('*');
    expect(screen.getByRole('button', { name: 'Add condition' }).style.backgroundColor).toBe('var(--primary)');
    fireEvent.click(remove);
    expect(JSON.parse(screen.getByTestId('conditions').textContent!).conditions.map((rule: { value: string }) => rule.value)).toEqual(['First', 'Middle', 'Last'].filter((_, i) => i !== index - 1));
    expect(screen.getByLabelText('Condition 2 value')).toBeTruthy();
    expect(screen.queryByLabelText('Condition 3 value')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(screen.getByLabelText('Condition 3 field')).toBeTruthy();
  });
  it('requires new condition values while keeping zero, false, empty operators and saved blank literals', () => {
    const conditions: WorkflowCondition = { operator: 'AND', conditions: [
      { field: 'deal.title', operator: 'equals', value: '' },
      { field: 'deal.value', operator: 'equals', value: 0 },
      { field: 'deal.customFieldValues.boolean', operator: 'equals', value: false },
      { field: 'deal.title', operator: 'is_empty', value: null },
    ] };
    expect(missingWorkflowConditionValues(conditions)).toEqual([0]);
    expect(missingWorkflowConditionValues(conditions, conditions)).toEqual([]);
    expect(missingWorkflowConditionValues(conditions, { ...conditions, conditions: [{ ...conditions.conditions[0], incompleteValue: true }] })).toEqual([0]);
    expect(missingWorkflowConditionValues({ ...conditions, conditions: [{ field: 'deal.title', operator: 'contains', value: '' }] }, conditions)).toEqual([0]);
  });
  it('preserves retired Lead details for review and removes them explicitly', () => {
    render(<Editor entity="lead" config={{ field: 'productInterestIds', value: ['others'], otherDetails: 'Saved service' }} />);
    expect(screen.queryByLabelText('Specify (optional)')).toBeNull();
    expect(screen.getByText(/Additional Product details are retired for Leads/).textContent).toContain('Saved service');
    fireEvent.click(screen.getByRole('button', { name: 'Remove retired setting' }));
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toEqual({ field: 'productInterestIds', value: ['others'] });
  });
  it('hides the value control for empty Product Interest and keeps Others a real selection', () => {
    const onChange = vi.fn();
    const trigger = WORKFLOW_TRIGGERS.find(t => t.type === 'lead.updated');
    const view = render(<ConditionFields options={options} trigger={trigger} value={{ operator: 'AND', conditions: [{ field: 'lead.productInterestIds', operator: 'is_empty', value: null }] }} onChange={onChange} />);
    expect(screen.queryByLabelText('Condition 1 value')).toBeNull();
    view.rerender(<ConditionFields options={options} trigger={trigger} value={{ operator: 'AND', conditions: [{ field: 'lead.productInterestIds', operator: 'contains', value: 'others' }] }} onChange={onChange} />);
    expect((screen.getByLabelText('Condition 1 value') as HTMLSelectElement).value).toBe('others');
  });
  it('keeps historical Deal Product, value and currency out of update actions', () => {
    render(<Editor entity="deal" config={{ field: '', value: '' }} />);
    expect(screen.queryByRole('option', { name: 'Deal Value' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Product Interest' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Currency' })).toBeNull();
    expect(WORKFLOW_TRIGGERS.find(t => t.type === 'deal.updated')?.fields.some(f => f.field === 'deal.value')).toBe(true);
  });
  it('keeps optional Others details for Contacts and requires an explicit clear choice', () => {
    render(<Editor entity="contact" config={{ field: 'productInterestIds', value: [] }} />);
    fireEvent.click(screen.getByLabelText('Others'));
    fireEvent.change(screen.getByLabelText('Specify (optional)'), { target: { value: 'Consulting' } });
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toMatchObject({ value: ['others'], otherDetails: 'Consulting' });
    fireEvent.click(screen.getByLabelText('Others'));
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toMatchObject({ value: [], otherDetails: '' });
    fireEvent.click(screen.getByLabelText('Clear this field'));
    expect(JSON.parse(screen.getByTestId('config').textContent!).clear).toBe(true);
  });
  it('keeps retired steps readable and excludes them from the action picker', () => {
    render(<ActionFields action={{ type: 'create_notification', config: { title: 'Existing' } }} options={options} entity="lead" onChange={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Notifications are automatic');
    expect(getAvailableActions().map(a => a.type)).toContain('send_sms');
    expect(getAvailableActions().map(a => a.type)).not.toContain('send_campaign');
  });
  it('checks normalized names and finds an unused duplicate name', () => {
    expect(workflowNameIssue('  Follow   UP ', [{ id: '1', name: 'follow up' }])).toContain('already exists');
    expect(workflowNameIssue('Follow Up', [{ id: '1', name: 'follow up' }], '1')).toBe('');
    expect(duplicateWorkflowName('Follow Up', [{ name: 'follow up (copy)' }])).toBe('Follow Up (Copy 2)');
  });
  it('requires a real Qualified stage and verified never-won history in the recipe', () => {
    const recipe = WORKFLOW_RECIPES.find(r => r.name === QUALIFIED_FOLLOW_UP_NAME)!;
    const draft = prepareWorkflowRecipe(recipe, { ...options, pipelines: [{ id: 'p', name: 'Sales', stages: [{ id: 'q', name: 'Qualified' }] }] });
    expect(draft.trigger).toBe('deal.stage_changed');
    expect(draft.conditions).toMatchObject({ operator: 'AND', conditions: expect.arrayContaining([
      { field: 'event.newStageId', operator: 'equals', value: 'q' },
      { field: 'deal.hasEverBeenWon', operator: 'equals', value: false },
      { field: 'deal.wonHistoryVerified', operator: 'equals', value: true },
    ]) });
    expect(recipe.conditions?.conditions[0].value).toBe('');
  });
});
