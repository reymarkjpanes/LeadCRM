import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BulkSelectionBar, type BulkActionResult } from '../bulk-selection-bar';

vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
afterEach(cleanup);

it('retains failed bulk records and retries only those records without repeating successful actions', async () => {
  const execute = vi.fn<(ids: string[]) => Promise<BulkActionResult>>()
    .mockResolvedValueOnce({ succeeded: ['first'], failed: ['second'] })
    .mockResolvedValueOnce({ succeeded: ['second'], failed: [] });
  function Harness() {
    const [ids, setIds] = useState(new Set(['first', 'second']));
    return <BulkSelectionBar selectedCount={ids.size} selectedIds={ids} onClearSelection={() => setIds(new Set())}
      onRemoveIds={removed => setIds(previous => new Set([...previous].filter(id => !removed.includes(id))))}
      actions={[{ id: 'archive', label: 'Archive', destructive: true, entityName: 'user', onExecute: execute }]} />;
  }
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(screen.getByText(/Archiving deactivates these accounts/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  expect((await screen.findByRole('alert')).textContent).toContain('1 succeeded, 1 failed');
  expect(screen.getByRole('alertdialog', { name: 'Archive 1 user?' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(execute.mock.calls.map(([ids]) => ids)).toEqual([['first', 'second'], ['second']]);
});

it('keeps non-destructive failures in the original direct-action flow', async () => {
  const execute = vi.fn().mockResolvedValue({ succeeded: [], failed: ['first'] });
  render(<BulkSelectionBar selectedCount={1} selectedIds={new Set(['first'])} onClearSelection={vi.fn()}
    actions={[{ id: 'update', label: 'Update', destructive: false, onExecute: execute }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(execute).toHaveBeenCalledWith(['first']));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
