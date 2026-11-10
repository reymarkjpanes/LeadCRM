import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import { toast } from '@/shared/utils/toast';
import { WorkflowCreateDialog } from './workflow-create-dialog';
import { WORKFLOW_RECIPES, WORKFLOW_STARTER_TEMPLATES } from '../services/workflow-recipes';

vi.mock('@/shared/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => { Element.prototype.scrollTo = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(overrides: Partial<React.ComponentProps<typeof WorkflowCreateDialog>> = {}) {
  const onChoose = vi.fn(), onClose = vi.fn();
  render(<WorkflowCreateDialog triggers={WORKFLOW_TRIGGERS} actions={getAvailableActions()} onClose={onClose} onChoose={onChoose} {...overrides} />);
  return { onChoose, onClose };
}

it.each(WORKFLOW_STARTER_TEMPLATES.map(({ recipe, index }) => [recipe.name, index] as const))('previews and opens the original index for %s after filtering', async (name, index) => {
  const { onChoose } = setup();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ` ${name.toUpperCase()} ` } });
  fireEvent.click(screen.getByRole('button', { name: `Preview ${name}` }));
  expect(screen.getByRole('list', { name: 'Template steps' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Template setup requirements' })).toBeTruthy();
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  await waitFor(() => expect(onChoose).toHaveBeenCalledExactlyOnceWith(index));
  expect(toast.success).not.toHaveBeenCalled();
});

it('shows the supported starters and excludes hidden recipes from search', () => {
  setup();
  expect(screen.getByRole('status').textContent).toBe('14 templates available');
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(14);
  const starters = new Set(WORKFLOW_STARTER_TEMPLATES.map(entry => entry.index));
  WORKFLOW_RECIPES.forEach((recipe, index) => {
    if (starters.has(index)) return;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: recipe.name } });
    expect(screen.queryByRole('button', { name: `Preview ${recipe.name}` })).toBeNull();
    for (const button of screen.queryAllByRole('button', { name: /^Preview / })) {
      expect(WORKFLOW_STARTER_TEMPLATES.some(entry => `Preview ${entry.recipe.name}` === button.getAttribute('aria-label'))).toBe(true);
    }
  });
});

it('shows one template description and keeps optional execution notes expandable', () => {
  setup();
  const { recipe } = WORKFLOW_STARTER_TEMPLATES[0];
  fireEvent.click(screen.getByRole('button', { name: `Preview ${recipe.name}` }));
  expect(screen.getAllByText(recipe.description!)).toHaveLength(1);
  const details = screen.getByText('Execution details').closest('details')!;
  expect(details.open).toBe(false);
  expect(screen.getByRole('region', { name: 'Template setup requirements' })).toBeTruthy();
});

it('searches multiple template words with extra whitespace', () => {
  setup();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  EMAIL   new   LEAD ' } });
  expect(screen.getByRole('button', { name: 'Preview New Lead Email Welcome' })).toBeTruthy();
});

it('combines record, action, and text filters, restores focus and explains an empty SMS selection', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'lead' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'send_email' } });
  expect(screen.getByRole('status').textContent).toBe('1 template of 14');
  const name = 'Preview New Lead Email Welcome';
  fireEvent.click(screen.getByRole('button', { name }));
  expect(screen.getByText(/Connect the record’s assigned agent to Gmail/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All templates' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name }));
  expect((screen.getByLabelText('Record type') as HTMLSelectElement).value).toBe('lead');
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'send_sms' } });
  expect(screen.getByText('No matching templates')).toBeTruthy();
  expect(screen.getByText(/Start from scratch to add a Send SMS action/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'account' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'create_task' } });
  expect(screen.getByText('Try another search or clear your filters.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(14);
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
});

it('offers Deal movement starters and excludes retired customer status routing', () => {
  const { onChoose } = setup();
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'move_deal_stage' } });
  expect(screen.getByRole('status').textContent).toBe('2 templates of 14');
  expect(screen.queryByRole('button', { name: 'Preview Qualified Deal Follow-up' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'contact' } });
  expect(screen.getByText('No matching templates')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'deal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview Automatic Deal Stage Update' }));
  expect(screen.getByRole('region', { name: 'Template setup requirements' }).textContent).toMatch(/pipeline.*source.*target/i);
  expect(screen.getByRole('list', { name: 'Template steps' }).textContent).not.toContain('Create Task');
  expect(onChoose).not.toHaveBeenCalled();
});

it('keeps incompatible templates inspectable and prevents opening them', () => {
  const onChoose = vi.fn();
  setup({ actions: getAvailableActions().filter(action => action.type !== 'send_email'), onChoose });
  fireEvent.click(screen.getByRole('button', { name: 'Preview New Lead Email Welcome' }));
  expect(screen.getByRole('alert').textContent).toContain('unavailable');
  expect((screen.getByRole('button', { name: 'Use this template' }) as HTMLButtonElement).disabled).toBe(true);
  expect(onChoose).not.toHaveBeenCalled();
});

it('contains keyboard focus, restores focus and scroll on close, and resets on reopen', () => {
  document.body.style.overflow = 'auto';
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open chooser</button>{open && <WorkflowCreateDialog triggers={WORKFLOW_TRIGGERS} actions={getAvailableActions()} onChoose={vi.fn()} onClose={() => setOpen(false)} />}</>;
  }
  render(<React.StrictMode><Harness /></React.StrictMode>);
  const opener = screen.getByRole('button', { name: 'Open chooser' });
  opener.focus(); fireEvent.click(opener);
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  expect(document.body.style.overflow).toBe('hidden');
  const close = screen.getByRole('button', { name: 'Close create workflow' });
  close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  opener.focus(); expect(document.activeElement).toBe(close);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'welcome' } });
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('auto');
  fireEvent.click(opener);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  document.body.style.overflow = '';
});

it('locks repeated handoffs, displays a failure once, and allows retry', async () => {
  let reject!: (error: Error) => void;
  const onChoose = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  setup({ onChoose });
  const scratch = screen.getByRole('button', { name: 'Start from scratch' });
  fireEvent.click(scratch); fireEvent.click(scratch);
  expect(onChoose).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(screen.getByText('Opening builder…')).toBeTruthy();
  await act(async () => reject(new Error('Navigation failed. Try again.')));
  expect(screen.getByRole('alert').textContent).toBe('Navigation failed. Try again.');
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('Navigation failed. Try again.');
  fireEvent.click(scratch);
  await waitFor(() => expect(onChoose).toHaveBeenCalledTimes(2));
});

it('offers one configurable stage template after loading pipeline options', async () => {
  const choices = { users: [], templates: [], campaigns: [], pipelines: [{ id: 'p1', name: 'Sales', stages: [
    { id: 'lead', name: 'Lead', isDefault: true }, { id: 'contacted', name: 'Contacted' },
    { id: 'qualified', name: 'Qualified', requiredFields: ['accountId'] }, { id: 'won', name: 'Approved', isWon: true }, { id: 'lost', name: 'Declined', isLost: true },
  ] }] };
  const { onChoose } = setup({ loadOptions: async () => choices });
  const preview = await screen.findByRole('button', { name: 'Preview Deal Entered a Specific Stage' });
  await waitFor(() => expect(screen.queryByText('Loading pipeline templates…')).toBeNull());
  expect(document.querySelector('[data-template-id^="stage:"]')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(14);
  fireEvent.click(preview);
  fireEvent.click(screen.getByText('Execution details'));
  expect(screen.getByRole('group', { name: 'Template behavior' }).textContent).toContain('Superseded queued entries are skipped');
  expect(screen.getByRole('region', { name: 'Template setup requirements' }).textContent).toContain('Choose the pipeline and entry stage');
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  await waitFor(() => expect(onChoose).toHaveBeenCalledExactlyOnceWith(25));
});

it('recovers a failed options read without adding per-stage template cards', async () => {
  const loadOptions = vi.fn().mockRejectedValueOnce(new Error('Pipeline choices unavailable')).mockResolvedValue({ users: [], pipelines: [{ id: 'p1', name: 'Current', stages: [{ id: 'custom', name: 'Custom review' }] }], templates: [], campaigns: [] });
  setup({ loadOptions });
  expect((await screen.findByRole('alert')).textContent).toContain('Pipeline choices unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry pipeline templates' }));
  await waitFor(() => expect(screen.queryByText('Pipeline choices unavailable')).toBeNull());
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(14);
});

it('retains the selected starter when pipeline options change; the builder validates the new choices', async () => {
  const initialOptions = { users: [], pipelines: [{ id: 'p1', name: 'Current', stages: [{ id: 'custom', name: 'Custom review' }] }], templates: [], campaigns: [] };
  const onChoose = vi.fn();
  const view = render(<WorkflowCreateDialog triggers={WORKFLOW_TRIGGERS} actions={getAvailableActions()} options={initialOptions} onClose={vi.fn()} onChoose={onChoose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview Deal Entered a Specific Stage' }));
  view.rerender(<WorkflowCreateDialog triggers={WORKFLOW_TRIGGERS} actions={getAvailableActions()} options={{ ...initialOptions, pipelines: [] }} onClose={vi.fn()} onChoose={onChoose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  await waitFor(() => expect(onChoose).toHaveBeenCalledExactlyOnceWith(25));
});
