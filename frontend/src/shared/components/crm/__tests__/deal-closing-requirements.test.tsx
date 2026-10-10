import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_CLOSING_FIELDS, type ClosingRequirementsState } from '@leadcrm/shared';
import { DealClosingRequirements } from '../deal-closing-requirements';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), upload: vi.fn(), refetch: vi.fn(), data: undefined as ClosingRequirementsState | undefined }));
vi.mock('@/lib/api/client', () => ({ apiClient: { patch: mocks.patch, upload: mocks.upload } }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: mocks.data, refetch: mocks.refetch, isInitialLoad: false, error: null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); mocks.data = { fields: DEFAULT_CLOSING_FIELDS, values: {}, files: [], errors: {}, locked: false }; });
afterEach(cleanup);

it('shows truthful completion and warns about automatic closing before the last required save', () => {
  render(<DealClosingRequirements dealId="deal" canEdit onSaved={() => {}} />);
  expect(screen.getByText('0 of 2 required complete')).toBeTruthy();
  expect(screen.getByText(/Add optional details before saving the final required field/)).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Required fields completed' }).getAttribute('aria-valuenow')).toBe('0');
});

it('does not report a missing persistent document as complete or expose its raw ID', () => {
  const field = { ...DEFAULT_CLOSING_FIELDS.find(f => f.type === 'File Upload')!, required: true };
  mocks.data = { fields: [field], values: { [field.id]: '78e2894b-d16c-47d7-875c-beb2a342638c' }, files: [], errors: {}, locked: false };
  render(<DealClosingRequirements dealId="deal" canEdit onSaved={() => {}} />);
  expect(screen.getByText('0 of 1 required complete')).toBeTruthy();
  expect(screen.getByText('File unavailable')).toBeTruthy();
  expect(screen.queryByText('78e2894b-d16c-47d7-875c-beb2a342638c')).toBeNull();
});

it('requires a successful persistent upload and an explicit save before completing a document', async () => {
  const field = { ...DEFAULT_CLOSING_FIELDS.find(f => f.type === 'File Upload')!, required: true };
  mocks.data!.fields = [field];
  mocks.upload.mockRejectedValueOnce(new Error('Upload failed.'));
  const id = '78e2894b-d16c-47d7-875c-beb2a342638c';
  const file = { id, name: 'approval.pdf', type: 'application/pdf', size: 100, url: '/download' };
  mocks.upload.mockResolvedValueOnce({ data: file });
  mocks.patch.mockResolvedValue({ data: { ...mocks.data, values: { [field.id]: id }, files: [file], locked: true } });
  render(<DealClosingRequirements dealId="deal" canEdit onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field.name}` }));
  const input = screen.getByLabelText(`${field.name} *`);
  const selected = new File(['%PDF-1.4'], 'approval.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [selected] } });
  await screen.findByText('Upload failed.');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mocks.patch).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [selected] } });
  await screen.findByText('Uploaded: approval.pdf');
  expect(mocks.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/crm/deals/deal/closing-requirements', { values: { [field.id]: id } }));
  expect(await screen.findByRole('link', { name: 'approval.pdf' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

it('locks every open inline editor when the backend confirms closing', async () => {
  mocks.data!.fields = DEFAULT_CLOSING_FIELDS.filter(f => ['confirmation-type', 'closing-notes'].includes(f.id));
  mocks.patch.mockResolvedValue({ data: { ...mocks.data, values: { 'confirmation-type': 'Approved Quotation' }, locked: true } });
  render(<DealClosingRequirements dealId="deal" canEdit onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Closing Notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Confirmation Type' }));
  fireEvent.change(screen.getByLabelText('Confirmation Type *'), { target: { value: 'Approved Quotation' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await screen.findByText('Closing evidence is preserved. Historical values cannot be edited.');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

it('uses the shared collapse and restores the same requirement content', () => {
  const view = render(<DealClosingRequirements dealId="deal" canEdit onSaved={() => {}} />);
  const toggle = screen.getByRole('button', { name: 'Closed Won Requirements' });
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('progressbar')).toBeNull();
  view.rerender(<DealClosingRequirements dealId="deal" canEdit focusRequested onSaved={() => {}} />);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('progressbar')).toBeTruthy();
});
