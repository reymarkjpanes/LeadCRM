import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => false }));
import { RecordFilesTab } from './record-files-tab';

afterEach(cleanup);

it('shows persisted file history metadata and a download action', () => {
  render(<RecordFilesTab files={[{
    id: 'file-1', name: 'agreement.pdf', size: 2048, type: 'application/pdf',
    uploadedAt: '2026-09-01T10:00:00.000Z', uploadedBy: 'Ava Cruz', url: '/api/proxy/crm/leads/lead-1/files/file-1/download',
  }]} />);
  expect(screen.getByText('agreement.pdf')).toBeTruthy();
  expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
  expect(screen.getByText(/Ava Cruz/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Download agreement.pdf' }).getAttribute('href')).toContain('/files/file-1/download');
});

it('shows a disabled upload loading state until the API call settles', async () => {
  let finishUpload!: () => void;
  const onUpload = vi.fn(() => new Promise<void>(resolve => { finishUpload = resolve; }));
  render(<RecordFilesTab files={[]} onUpload={onUpload} />);
  const picker = screen.getByLabelText('Choose file') as HTMLInputElement;
  const file = new File(['%PDF-1.7\nattachment'], 'agreement.pdf', { type: 'application/pdf' });
  fireEvent.change(picker, { target: { files: [file] } });
  expect(await screen.findByRole('status', { name: 'Uploading file' })).toBeTruthy();
  expect(picker.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();
  await act(async () => { finishUpload(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy());
  expect(onUpload).toHaveBeenCalledWith(file);
  expect(toast.success).toHaveBeenCalledWith('agreement.pdf uploaded');
});

it('shows a useful upload error and lets the user retry', async () => {
  const retryUpload = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
  render(<RecordFilesTab files={[]} error="Could not load files." onRetry={retryUpload} onUpload={retryUpload} />);
  expect(screen.getByRole('alert').textContent).toContain('Could not load files.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry files' }));
  const picker = screen.getByLabelText('Choose file');
  fireEvent.change(picker, { target: { files: [new File(['%PDF-1.7'], 'agreement.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Storage unavailable'));
  expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
});
