import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultContactForm, type FormSubmissionRecord } from '@leadcrm/shared';
import { FormSharePanel } from './form-share-panel';
import { formsApi } from '@/shared/services/forms.api';

vi.mock('@/shared/services/forms.api', () => ({ formsApi: { submissions: vi.fn() } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 'tenant' } }) }));
const permissions = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => permissions.allowed }));
const id = '0ff82f9c-48e9-4e1c-8c77-8a30755d704c', archived = '11111111-1111-4111-8111-111111111111', missing = '22222222-2222-4222-8222-222222222222';
const form = { ...defaultContactForm(), id: 'form', tenantId: 'tenant', publicId: 'public', revision: 1, publishedRevision: 1, publishedVersion: 1, status: 'published' as const, createdAt: '', updatedAt: '' };
const submission: FormSubmissionRecord = { id: 'submission', formId: form.id, leadId: 'lead', contactId: null, submittedAt: '2026-10-07T10:12:00Z', publishedVersion: 1,
  publishedConfig: { ...defaultContactForm(), fields: [...form.fields, { id: 'custom', type: 'single-line', label: 'Custom answer', required: false, width: 'full' }] },
  values: { firstName: 'Customer', productInterest: [id, archived, missing], custom: 'Actual dynamic answer' }, tracking: {}, notificationStatus: 'not_requested',
  productLabels: { [id]: 'Electric Fence', [archived]: 'Archived Product' },
};
const mount = () => render(<FormSharePanel form={form} dirty={false} shareLink="https://example.test/forms/public" embedCode="<iframe />" />);
beforeEach(() => { vi.clearAllMocks(); permissions.allowed = true; vi.mocked(formsApi.submissions).mockResolvedValue({ data: [submission], meta: { hasMore: false } }); });
afterEach(cleanup);

it('loads a collapsed dynamic list, resolves multiple Product IDs, and shows no raw UUIDs', async () => {
  const view = mount();
  expect(screen.getByRole('status', { name: 'Loading submissions' }).querySelector('.animate-spin')).toBeTruthy();
  await waitFor(() => expect(view.container.querySelectorAll('details')).toHaveLength(1));
  const detail = view.container.querySelector('details')!;
  expect(detail.open).toBe(false); fireEvent.click(detail.querySelector('summary')!); expect(detail.open).toBe(true);
  expect(detail.textContent).toContain('Electric Fence\nArchived Product\nUnavailable product');
  expect(detail.textContent).toContain('Actual dynamic answer');
  expect(detail.textContent).not.toContain(id); expect(detail.textContent).not.toContain(missing);
  expect(screen.getByRole('heading', { name: 'Embed Code' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Share Link' })).toBeTruthy();
  expect(screen.queryByText('Refresh submissions')).toBeNull();
});

it('locks refresh, keeps disclosure state, de-duplicates appended pages and resets refresh to page one', async () => {
  vi.mocked(formsApi.submissions).mockResolvedValue({ data: [submission], meta: { hasMore: true } });
  const view = mount(); await screen.findByText('Load more');
  const detail = view.container.querySelector('details')!; fireEvent.click(detail.querySelector('summary')!);
  fireEvent.click(screen.getByText('Load more'));
  await waitFor(() => expect(formsApi.submissions).toHaveBeenLastCalledWith('form', 2, expect.any(AbortSignal)));
  const refresh = screen.getByRole('button', { name: 'Refresh submissions' });
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  expect(view.container.querySelectorAll('details')).toHaveLength(1);
  let finish!: (value: any) => void;
  vi.mocked(formsApi.submissions).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(refresh); fireEvent.click(refresh);
  expect(formsApi.submissions).toHaveBeenCalledTimes(3);
  expect(formsApi.submissions).toHaveBeenLastCalledWith('form', 1, expect.any(AbortSignal));
  expect(screen.getByRole('status', { name: 'Loading submissions' }).textContent).toBe('');
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  finish({ data: [submission], meta: { hasMore: false } });
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
  expect(detail.open).toBe(true);
});

it('supports comma-separated IDs and legacy product labels', async () => {
  vi.mocked(formsApi.submissions).mockResolvedValue({ data: [{ ...submission, values: { productInterest: `${id},${archived},Legacy service` } }], meta: { hasMore: false } });
  const view = mount(); await waitFor(() => expect(view.container.querySelector('details')).toBeTruthy());
  expect(view.container.querySelector('dd')?.textContent).toBe('Electric Fence\nArchived Product\nLegacy service');
});

it('shows an empty state, reports failure, and retries without losing the section', async () => {
  vi.mocked(formsApi.submissions).mockRejectedValueOnce(new Error('Network failed')).mockResolvedValue({ data: [], meta: { hasMore: false } });
  mount(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh submissions' }));
  await screen.findByText('No submissions yet.'); expect(screen.queryByRole('alert')).toBeNull();
});

it('does not request or expose submission history without permission', () => {
  permissions.allowed = false; mount(); expect(formsApi.submissions).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Submission History' })).toBeNull();
});
