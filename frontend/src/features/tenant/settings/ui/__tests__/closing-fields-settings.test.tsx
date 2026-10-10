import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_CLOSING_FIELDS } from '@leadcrm/shared';
import { ClosingFieldsSettings } from '../closing-fields-settings';

const mocks = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), refetch: vi.fn(), success: vi.fn(), allowed: true }));
vi.mock('@/lib/api/client', () => ({ apiClient: mocks }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => mocks.allowed }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: DEFAULT_CLOSING_FIELDS, refetch: mocks.refetch, isInitialLoad: false, error: null }) }));
vi.mock('@/shared/components/sliding-drawer', () => ({ SlidingDrawer: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) => isOpen ? <section aria-label={title}><h2>{title}</h2>{children}</section> : null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
beforeEach(() => { mocks.allowed = true; vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.clearAllMocks(); mocks.post.mockResolvedValue({ data: { id: 'new-id' } }); mocks.patch.mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('exposes closing fields without the Deal Stage Automation settings card', () => {
  render(<ClosingFieldsSettings />);
  expect(screen.getByText(DEFAULT_CLOSING_FIELDS[0].name)).toBeTruthy();
  expect(screen.queryByText('Deal Stage Automation')).toBeNull();
  expect(mocks.patch).not.toHaveBeenCalled();
});

it('edits the selected ID, then starts a clean create form without leaking values or validation', async () => {
  render(<ClosingFieldsSettings />);
  fireEvent.click(screen.getByRole('button', { name: `${DEFAULT_CLOSING_FIELDS[0].name} actions` }));
  fireEvent.click(screen.getByText('Edit Field'));
  expect(screen.getByRole('heading', { name: 'Edit Field' })).toBeTruthy();
  expect((screen.getByLabelText(/Field Type/) as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Field Name/), { target: { value: 'Edited confirmation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith(`/administration/closing-requirements/${DEFAULT_CLOSING_FIELDS[0].id}`, expect.objectContaining({ name: 'Edited confirmation' })));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Field' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Add New Field' }));
  expect(screen.queryByLabelText(/Applies To/)).toBeNull();
  expect((screen.getByLabelText(/Field Name/) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('switch', { name: 'Required' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText(/Field Type/) as HTMLSelectElement).value).toBe('Text');
  fireEvent.click(screen.getByRole('button', { name: 'Create Field' }));
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Field Name/), { target: { value: 'A new field' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Field' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/administration/closing-requirements', expect.objectContaining({ name: 'A new field', options: [], required: false })));
  expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('id');
  expect(mocks.success).toHaveBeenCalledWith('Field created');
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
});

it('disables field editing and hides creation without permission', () => {
  mocks.allowed = false;
  render(<ClosingFieldsSettings />);
  expect(screen.queryByRole('button', { name: 'Add New Field' })).toBeNull();
  expect((screen.getByRole('button', { name: `Manage ${DEFAULT_CLOSING_FIELDS[0].name}` }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Edit Field')).toBeNull();
});

it('discards unsaved New Field values after closing', () => {
  render(<ClosingFieldsSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Add New Field' }));
  fireEvent.change(screen.getByLabelText(/Field Name/), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add New Field' }));
  expect(screen.queryByLabelText(/Applies To/)).toBeNull();
  expect((screen.getByLabelText(/Field Name/) as HTMLInputElement).value).toBe('');
});

it('limits groups to the selected module and clears an incompatible selection', () => {
  render(<ClosingFieldsSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Add New Field' }));
  const groups = screen.getByLabelText(/Group \/ Section/) as HTMLSelectElement;
  expect(groups.tagName).toBe('SELECT');
  fireEvent.change(groups, { target: { value: 'Organization' } });
  fireEvent.change(screen.getByLabelText('Module *'), { target: { value: 'deals' } });
  expect(groups.value).toBe('');
  expect([...groups.options].map(option => option.value)).toContain('Closed Won Requirements');
  expect([...groups.options].map(option => option.value)).not.toContain('Organization');
});
