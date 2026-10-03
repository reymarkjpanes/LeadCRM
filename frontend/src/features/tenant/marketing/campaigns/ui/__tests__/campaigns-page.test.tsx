import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ get: vi.fn(), duplicate: vi.fn(), create: vi.fn(), archive: vi.fn(), refresh: vi.fn(), permitted: true, initial: false, refreshing: false }));
const campaign = { id: 'campaign', name: 'Saved campaign', type: 'Email', status: 'sent', targetAudience: 'All Leads', sentCount: 4, openedCount: 2, clickedCount: 1, createdAt: '2026-09-30' };
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 'tenant', } }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => mocks.permitted }));
vi.mock('../../hooks/use-campaigns-data', () => ({ useCampaignsData: () => ({ campaigns: [campaign], total: 1, templates: [], metrics: { activeCampaigns: 1, sent: 4, opened: 2, clicked: 1 }, isInitialLoad: mocks.initial, isRefreshing: mocks.refreshing, refetch: mocks.refresh }) }));
vi.mock('@/shared/services/campaigns.api', () => ({ campaignsApi: { get: mocks.get, duplicate: mocks.duplicate, create: mocks.create, archive: mocks.archive } }));
vi.mock('../campaign-builder', () => ({ CampaignBuilder: () => <div>Campaign editor</div> }));
vi.mock('../campaign-report-view', () => ({ CampaignReportView: () => <div>Campaign report</div> }));
import CampaignsPage from '../campaigns-page';
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); vi.clearAllMocks(); mocks.permitted = true; mocks.initial = false; mocks.refreshing = false; mocks.archive.mockResolvedValue({ success: true }); mocks.refresh.mockResolvedValue(undefined); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(cleanup);
it('opens View and duplicates the complete saved campaign into a new draft', async () => {
  mocks.get.mockResolvedValue({ data: { ...campaign, subject: 'Saved subject', body: '<p>Saved body</p>', audienceSource: 'LEADS' } });
  mocks.create.mockResolvedValue({ data: { id: 'copy' } });
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View', 'Duplicate', 'Archive']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith('campaign'));
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(screen.getByText('Campaign report')).toBeTruthy();
});
it('archives only selected campaigns after confirmation and refreshes', async () => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Archive 1 campaign?' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('campaign'));
  await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  expect(mocks.refresh).toHaveBeenCalled();
});
it('retains View without exposing forbidden mutations', () => {
  mocks.permitted = false;
  render(<CampaignsPage />);
  expect(screen.queryByRole('checkbox', { name: 'Select all records' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View']);
});

it('uses the Leads blue filter state and returns to inactive when closed', () => {
  render(<CampaignsPage />);
  const filter = screen.getByLabelText('Filter campaigns');
  fireEvent.click(filter); expect(filter.className).toContain('bg-[#2563EB]'); expect(filter.className).toContain('text-white');
  fireEvent.click(filter); expect(filter.className).toContain('bg-white'); expect(filter.getAttribute('aria-expanded')).toBe('false');
});
it.each(['initial', 'refreshing'] as const)('keeps the campaign controls visible during %s table loading', state => {
  mocks[state] = true; render(<CampaignsPage />);
  expect(screen.getByText('Loading campaigns...').parentElement?.querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByLabelText('Search campaigns')).toBeTruthy(); expect(screen.getByLabelText('Filter campaigns')).toBeTruthy();
  expect(screen.queryByRole('grid')).toBeNull();
});
