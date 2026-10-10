import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/features/tenant/dashboard/ui/dashboard', () => ({ default: ({ heading, renderToolbarActions }: any) => <div>{heading}{renderToolbarActions({ query: { range: 'last3', revenueInterval: 'week' }, report: { period: { start: '2026-08-01', end: '2026-10-10' } }, error: null, className: 'existing-toolbar-style' })}</div> }));
import ReportsPage from './reports-page';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('uses the canonical reporting UI with its export and report title', () => {
  render(<ReportsPage />);
  expect(screen.getByText('Analytics & Reports')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
});

it('retains authorized CSV export with the current reporting filters', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['report']) });
  vi.stubGlobal('fetch', fetch);
  URL.createObjectURL = vi.fn().mockReturnValue('blob:report');
  URL.revokeObjectURL = vi.fn();
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ReportsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith('/api/proxy/reporting/dashboard/export?range=last3&revenueInterval=week', { credentials: 'include', cache: 'no-store' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
});
