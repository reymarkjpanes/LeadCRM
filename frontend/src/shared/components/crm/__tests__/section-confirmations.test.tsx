import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomFieldsSection } from '../custom-fields-section';
import { FilesSection } from '../files-section';

afterEach(cleanup);

it.each(['file', 'custom field'])('keeps the %s deletion open on failure and only closes after a successful retry', async kind => {
  const remove = vi.fn().mockRejectedValueOnce(new Error('Permission denied. Ask your administrator for access.')).mockResolvedValue(undefined);
  if (kind === 'file') render(<FilesSection files={[{ id: 'record', name: 'Contract', size: 100, url: '#', uploadedBy: 'Ana', uploadedAt: '2026-10-09' }]}
    canUpload={false} canDelete onUpload={vi.fn()} onDelete={remove} />);
  else render(<CustomFieldsSection fields={[{ id: 'record', name: 'Contract', type: 'text', value: 'Signed' }]}
    canEdit onAdd={vi.fn()} onUpdate={vi.fn()} onDelete={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Contract' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Contract' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(remove.mock.calls).toEqual([['record'], ['record']]);
});
