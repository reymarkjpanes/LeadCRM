import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import { toast } from 'sonner';
import { WorkflowCreateDialog } from './workflow-create-dialog';
import { WORKFLOW_RECIPES, WORKFLOW_STARTER_TEMPLATES } from '../services/workflow-recipes';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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

it('shows only the nine approved starters and excludes removed templates from search', () => {
  setup();
  expect(screen.getByRole('status').textContent).toBe('9 templates available');
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(9);
  const starters = new Set(WORKFLOW_STARTER_TEMPLATES.map(entry => entry.index));
  WORKFLOW_RECIPES.forEach((recipe, index) => {
    if (starters.has(index)) return;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: recipe.name } });
    expect(screen.queryByRole('button', { name: `Preview ${recipe.name}` })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('0 templates of 9');
  });
});

it('combines record, action, and text filters; returns to the same result and focus; clears empty SMS results', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'lead' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'send_email' } });
  expect(screen.getByRole('status').textContent).toBe('1 template of 9');
  const name = 'Preview New Lead Email Welcome';
  fireEvent.click(screen.getByRole('button', { name }));
  expect(screen.getByText(/connect the selected sender to Gmail/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All templates' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name }));
  expect((screen.getByLabelText('Record type') as HTMLSelectElement).value).toBe('lead');
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'send_sms' } });
  expect(screen.getByText(/No SMS templates are included yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(9);
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
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
