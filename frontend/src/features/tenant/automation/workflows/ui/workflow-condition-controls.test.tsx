import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TriggerDefinition, WorkflowCondition } from '@leadcrm/shared';
import { ConditionFields } from './workflow-fields';

const options = { users: [], pipelines: [], templates: [], campaigns: [] };
const trigger: TriggerDefinition = { type: 'deal.updated', label: 'Deal Updated', entity: 'deal', fields: [
  { field: 'deal.title', label: 'Title', type: 'string' },
  { field: 'deal.value', label: 'Value', type: 'number' },
  { field: 'deal.customFieldValues.quantity', label: 'Quantity', type: 'number', group: 'custom' },
  { field: 'deal.hasEverBeenWon', label: 'Won before', type: 'boolean' },
  { field: 'deal.expectedCloseDate', label: 'Close date', type: 'date' },
  { field: 'deal.priority', label: 'Priority', type: 'enum', options: ['LOW', 'HIGH'] },
] };
const initial: WorkflowCondition = { operator: 'AND', conditions: [{ field: 'deal.title', operator: 'contains', value: 'Draft' }] };
function Harness({ metadata = trigger, conditions = initial }: { metadata?: TriggerDefinition; conditions?: WorkflowCondition }) {
  const [value, setValue] = useState(conditions);
  return <><ConditionFields value={value} trigger={metadata} options={options} onChange={setValue} /><output data-testid="rules">{JSON.stringify(value.conditions)}</output></>;
}
const rule = () => JSON.parse(screen.getByTestId('rules').textContent!)[0];
afterEach(cleanup);

describe('type-aware Workflow condition controls', () => {
  it('drops a saved cancellation reason from the choices after switching fields', () => {
    const metadata: TriggerDefinition = { ...trigger, fields: [
      ...trigger.fields,
      { field: 'deal.lostReason', label: 'Cancellation Reason', type: 'string' },
    ] };
    render(<Harness metadata={metadata} conditions={{ ...initial, conditions: [{ ...initial.conditions[0], field: 'deal.lostReason' }] }} />);
    const field = screen.getByLabelText('Condition 1 field');
    expect(screen.getByRole('option', { name: 'Cancellation Reason' })).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: 'deal.customFieldValues.quantity' } });
    expect(screen.queryByRole('option', { name: 'Cancellation Reason' })).toBeNull();
    expect(rule()).toEqual({ field: 'deal.customFieldValues.quantity', operator: 'equals', value: '' });
  });

  it.each(['deal.value', 'deal.customFieldValues.quantity'])('shows the six Number operators in order for %s and requires an explicit operand', field => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: field } });
    const operator = screen.getByLabelText('Condition 1 operator') as HTMLSelectElement;
    expect([...operator.options].map(option => option.text)).toEqual(['Equals', 'Not equals', 'Greater than', 'Greater than or equal', 'Less than', 'Less than or equal']);
    expect(rule()).toEqual({ field, operator: 'equals', value: '' });
    expect(screen.getByText('Enter a valid number.')).toBeTruthy();
    const input = screen.getByLabelText('Condition 1 value') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '0' } });
    expect(rule().value).toBe(0);
    expect(screen.queryByText('Enter a valid number.')).toBeNull();
    fireEvent.change(input, { target: { value: '-2.5' } });
    expect(rule().value).toBe(-2.5);
    fireEvent.change(input, { target: { value: '' } });
    expect(rule().value).toBe('');
  });

  it('requires an explicit Boolean choice, preserves false, and resets operands between different fields', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: 'deal.hasEverBeenWon' } });
    expect(rule().value).toBe('');
    expect(screen.getByText('Choose Yes or No.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: 'false' } });
    expect(rule().value).toBe(false);
    fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'not_equals' } });
    expect(rule().value).toBe(false);
    fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: 'deal.priority' } });
    expect(rule()).toEqual({ field: 'deal.priority', operator: 'not_equals', value: '' });
    expect((screen.getByLabelText('Condition 1 value') as HTMLSelectElement).value).toBe('');
  });

  it('clears operands for empty operators and restores pending input when returning to a scalar', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'is_empty' } });
    expect(rule().value).toBeNull();
    expect(screen.queryByLabelText('Condition 1 value')).toBeNull();
    fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'equals' } });
    expect(rule().value).toBe('');
    expect(screen.getByLabelText('Condition 1 value').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: 'deal.expectedCloseDate' } });
    expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).type).toBe('date');
    expect(screen.getByText('Choose a valid date.')).toBeTruthy();
  });

  it('keeps unavailable saved selections readable and disables dependent controls without changing the rule', () => {
    const onChange = vi.fn();
    const value: WorkflowCondition = { operator: 'AND', conditions: [{ field: 'deal.customFieldValues.retired', operator: 'greater_than', value: 12 }] };
    render(<ConditionFields value={value} options={options} trigger={trigger} onChange={onChange} />);
    expect((screen.getByLabelText('Condition 1 operator') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).value).toBe('12');
    expect(screen.getByText(/This field is unavailable/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves unsupported operators for explicit repair and respects historical blank literals', () => {
    const onChange = vi.fn();
    const value: WorkflowCondition = { operator: 'AND', conditions: [{ field: 'deal.value', operator: 'contains', value: 2 }] };
    const view = render(<ConditionFields value={value} options={options} trigger={trigger} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Unavailable operator — repair required' })).toBeTruthy();
    expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    const saved: WorkflowCondition = { operator: 'AND', conditions: [{ field: 'deal.title', operator: 'equals', value: '' }] };
    view.rerender(<ConditionFields value={saved} previousConditions={saved} options={options} trigger={trigger} onChange={onChange} />);
    expect(screen.queryByText('Enter a value or choose an empty-value operator.')).toBeNull();
  });

  it('adds Number rules with the same pending value as field selection', () => {
    render(<Harness metadata={{ ...trigger, fields: [trigger.fields[1]] }} conditions={{ operator: 'AND', conditions: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(rule()).toEqual({ field: 'deal.value', operator: 'equals', value: '' });
  });

  it('selects Changed fields by canonical keys, preserves unavailable saved values, and clears operands for presence operators', () => {
    const metadata: TriggerDefinition = { ...trigger, fields: [{ field: 'event.changedFields', label: 'Changed fields', type: 'list', options: ['title', 'customFieldValues.score'], optionLabels: { title: 'Title', 'customFieldValues.score': 'Score' } }] };
    render(<Harness metadata={metadata} conditions={{ operator: 'OR', conditions: [{ field: 'event.changedFields', operator: 'not_contains', value: 'oldField' }] }} />);
    const value = screen.getByLabelText('Condition 1 value') as HTMLSelectElement;
    expect(value.tagName).toBe('SELECT');
    expect(value.value).toBe('oldField');
    expect(screen.getByRole('option', { name: 'Unavailable selection' })).toBeTruthy();
    expect(screen.getByText('Choose an available value.')).toBeTruthy();
    fireEvent.change(value, { target: { value: 'customFieldValues.score' } });
    expect(rule().value).toBe('customFieldValues.score');
    expect(screen.queryByText('Choose an available value.')).toBeNull();
    expect(screen.getByText('Empty values do not match this comparison. Use Is empty to match missing values.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'is_empty' } });
    expect(rule().value).toBeNull();
    expect(screen.queryByLabelText('Condition 1 value')).toBeNull();
    fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'contains' } });
    expect(rule().value).toBe('');
  });

  it.each([false, 0])('does not hide a mistyped saved choice value %s', value => {
    render(<Harness conditions={{ operator: 'AND', conditions: [{ field: 'deal.priority', operator: 'equals', value }] }} />);
    expect((screen.getByLabelText('Condition 1 value') as HTMLSelectElement).value).toBe(String(value));
    expect(screen.getByRole('option', { name: 'Unavailable selection' })).toBeTruthy();
    expect(screen.getByText('Enter a text value.')).toBeTruthy();
    expect(rule().value).toBe(value);
  });
});
