import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignReportView } from '../campaign-report-view';
import { campaignsApi } from '@/shared/services/campaigns.api';
vi.mock('@/shared/services/campaigns.api', () => ({ campaignsApi: { report: vi.fn() } }));
const campaign = { id: 'campaign', name: 'Autumn update', type: 'Email', status: 'sent', targetAudience: 'Customers', sentCount: 4, engagement: 0, createdAt: '2026-10-02', sentAt: '2026-10-02T02:10:00Z' } as const;
const recipients = [
  { id: 'a', name: 'Doris Testing', email: 'doris@example.com', deliveryStatus: 'Delivered', opened: true, clicked: false },
  { id: 'b', name: 'Luis Reyes', email: 'luis@example.com', deliveryStatus: 'Delivered', opened: true, clicked: true },
  { id: 'c', name: 'Mara Santos', email: 'mara@example.com', deliveryStatus: 'Bounced', opened: false, clicked: false },
  { id: 'd', name: 'Anna Cruz', email: 'anna@example.com', deliveryStatus: 'Delivered', opened: false, clicked: false },
].map(row => ({ ...row, lastActivity: '2026-10-02T03:13:00Z', failureReason: null }));
const response = () => ({ success: true, data: { ...campaign, recipientCount: 4, deliveredCount: 3, openedCount: 2, clickedCount: 1, bouncedCount: 1,
  totalOpens: 3, uniqueOpens: 2, totalClicks: 2, uniqueClicks: 1, ctr: 100 / 3, ctor: 50, trackingStatus: 'recorded', trackingUpdatedAt: '2026-10-02T03:13:00Z',
  recipients, topLinks: [{ url: 'https://camxian.com/cctv-surveillance-system', uniqueClicks: 1, totalClicks: 2, clickRate: 100 / 3, clickShare: 100, lastClicked: '2026-10-02T03:13:00Z' }] } });
const mount = () => render(<CampaignReportView campaign={campaign as never} onBack={vi.fn()} />);
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.mocked(campaignsApi.report).mockResolvedValue(response() as never); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const filterPanel = () => document.querySelector('aside.hidden') as HTMLElement;
const select = (label: string) => {
  const trigger = screen.getByRole('button', { name: 'Filter recipients' });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  within(filterPanel()).getAllByRole('checkbox').filter(control => (control as HTMLInputElement).checked).forEach(control => fireEvent.click(control));
  if (label !== 'All recipients') fireEvent.click(within(filterPanel()).getByRole('checkbox', { name: `Filter by ${label}` }));
};
const rows = () => within(screen.getAllByRole('grid')[0]).getAllByRole('row').slice(1);
describe('campaign report', () => {
  it('explains interrupted submissions without claiming uncertain recipients were retried', async () => {
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: { ...response().data, status: 'INTERRUPTED', submissionInterruptedAt: '2026-10-09T01:00:00Z' } } as never);
    mount(); await screen.findByText('Doris Testing');
    expect(screen.getAllByText('Interrupted').length).toBeGreaterThan(0);
    expect(screen.getByText(/Unconfirmed recipients may have been accepted/)).toBeTruthy();
    expect(screen.getByText(/no recipients were automatically retried/)).toBeTruthy();
  });
  it('shows five original links by default and expands all without losing full URLs', async () => {
    const next = response();
    next.data.topLinks = Array.from({ length: 6 }, (_, i) => ({ ...next.data.topLinks[0], url: `https://camxian.com/products?id=${i}#detail` }));
    vi.mocked(campaignsApi.report).mockResolvedValue(next as never);
    mount(); await screen.findByText('Doris Testing');
    expect(within(screen.getAllByRole('grid')[1]).getAllByRole('row')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Show All' }));
    expect(within(screen.getAllByRole('grid')[1]).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'https://camxian.com/products?id=5#detail' }).getAttribute('title')).toBe('https://camxian.com/products?id=5#detail');
    fireEvent.click(screen.getByRole('button', { name: 'Show Top Five' }));
    expect(screen.queryByRole('link', { name: 'https://camxian.com/products?id=5#detail' })).toBeNull();
  });
  it('shows historical recipient evidence even when repeatable event totals are unavailable and disables failed exports', async () => {
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: { ...response().data, totalClicks: null, uniqueClicks: null, totalOpens: null, uniqueOpens: null, ctr: null, ctor: null, topLinks: [], trackingStatus: 'historical_unavailable' } } as never);
    mount(); await screen.findByText('Doris Testing');
    const metrics = screen.getByRole('region', { name: 'Campaign metrics' });
    expect(metrics.textContent).toContain('Opened2');
    expect(metrics.textContent).toContain('Total Clicks1');
    expect(metrics.textContent).not.toContain('Unavailable');
    expect(screen.getByText('Clicks were recorded, but their destination URLs are unavailable.')).toBeTruthy();
    vi.mocked(campaignsApi.report).mockRejectedValueOnce(new Error('Provider synchronization temporarily unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Export report' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('distinguishes unattributed provider clicks from a campaign with no clicks', async () => {
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: { ...response().data, topLinks: [] } } as never);
    mount(); await screen.findByText('Doris Testing');
    expect(screen.getByText('Clicks were recorded, but their destination URLs are unavailable.')).toBeTruthy();
    expect(screen.queryByText('No links have been clicked yet.')).toBeNull();
  });
  it('reports SMS phone and provider states without email engagement metrics', async () => {
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: { ...response().data, type: 'SMS', recipients: [
      { ...recipients[0], email: null, phone: '+639171234567', deliveryStatus: 'Sent', opened: false },
      { ...recipients[1], email: null, phone: '+639181234567', deliveryStatus: 'Pending', opened: false, clicked: false },
      { ...recipients[2], email: null, phone: '+639191234567', deliveryStatus: 'Failed' },
    ], failedCount: 1, topLinks: [] } } as never);
    render(<CampaignReportView campaign={{ ...campaign, type: 'SMS' } as never} onBack={vi.fn()} />);
    await screen.findByText('+639171234567');
    const metrics = screen.getByRole('region', { name: 'Campaign metrics' });
    expect(within(metrics).getAllByRole('heading').map(el => el.textContent)).toEqual(['Recipients', 'Submitted', 'Sent', 'Delivered', 'Failed']);
    expect(metrics.textContent).toContain('Failed1');
    expect(screen.queryByRole('columnheader', { name: 'Email' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Opened' })).toBeNull(); expect(screen.queryByRole('columnheader', { name: 'Clicked' })).toBeNull();
    expect(screen.queryByText('No clicked links recorded for this campaign.')).toBeNull();
    select('Pending'); expect(rows()).toHaveLength(1);
    expect(screen.queryByText('Requires review')).toBeNull();
    select('All recipients'); fireEvent.change(screen.getByLabelText('Search recipients'), { target: { value: '63919' } }); expect(rows()).toHaveLength(1);
  });
  it('renders real counts, delivery and engagement values, dates and link data without the retired panels', async () => {
    mount(); await screen.findByText('Doris Testing');
    expect(screen.getByRole('heading', { name: 'Autumn update Report' })).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Campaign details' });
    expect(within(details).getByText('Submitted')).toBeTruthy();
    expect(within(details).queryByText('Sent', { selector: 'dt' })).toBeNull();
    const metrics = screen.getByRole('region', { name: 'Campaign metrics' });
    expect(within(metrics).getAllByRole('heading').map(el => el.textContent)).toEqual(['Recipients', 'Delivered', 'Submitted', 'Opened', 'Total Clicks', 'Bounced']);
    expect(metrics.textContent).toContain('Recipients4'); expect(metrics.textContent).toContain('Delivered3'); expect(metrics.textContent).toContain('Opened2');
    expect(metrics.textContent).toContain('Total Clicks1'); expect(metrics.textContent).toContain('Bounced1');
    expect(rows()).toHaveLength(4); expect(screen.getAllByLabelText('Opened')).toHaveLength(2); expect(screen.getAllByLabelText('Not opened')).toHaveLength(2);
    const links = screen.getAllByRole('grid')[1];
    expect(within(links).getAllByRole('columnheader').map(el => el.textContent)).toEqual(['Link URL', 'Total Clicks']);
    expect(within(links).getAllByRole('row')[1].textContent).toContain('1');
    expect(within(links).getAllByRole('row')[1].textContent).not.toContain('2');
    expect(screen.getAllByLabelText('Clicked')).toHaveLength(1); expect(screen.getByRole('link', { name: /camxian/ }).getAttribute('href')).toContain('/cctv-surveillance-system');
    expect(screen.queryByText(/2026-10-02T/)).toBeNull(); expect(screen.getAllByText(/Oct 2, 2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Engagement Overview')).toBeNull(); expect(screen.queryByText('Device Breakdown')).toBeNull(); expect(screen.queryByText('Sent Overview')).toBeNull();
  });
  it.each([['Delivered', 3], ['Bounced', 1], ['Opened', 2], ['Clicked', 1], ['All recipients', 4]])('filters %s across all recipient records', async (filter, count) => {
    mount(); await screen.findByText('Doris Testing'); select(String(filter)); expect(rows()).toHaveLength(count as number);
  });
  it('combines name/email search with status and shows a meaningful no-match state', async () => {
    mount(); await screen.findByText('Doris Testing'); select('Delivered');
    fireEvent.change(screen.getByLabelText('Search recipients'), { target: { value: ' LUIS@EXAMPLE ' } });
    expect(rows()).toHaveLength(1); expect(screen.getByText('1 of 4 recipients')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search recipients'), { target: { value: 'Doris Testing' } }); expect(screen.getByText('Doris Testing')).toBeTruthy();
    select('Bounced'); expect(screen.getByText('No recipients match your search and filter.')).toBeTruthy();
  });
  it('uses the shared filter rail for combined delivery/engagement selections, filter search and clearing', async () => {
    mount(); await screen.findByText('Doris Testing'); select('Delivered');
    fireEvent.click(within(filterPanel()).getByRole('checkbox', { name: 'Filter by Clicked' }));
    expect(rows()).toHaveLength(1); expect(screen.getByText('Luis Reyes')).toBeTruthy();
    fireEvent.click(within(filterPanel()).getByRole('checkbox', { name: 'Filter by Opened' }));
    expect(rows()).toHaveLength(2);
    fireEvent.change(within(filterPanel()).getByLabelText('Search filters'), { target: { value: 'clicked' } });
    expect(within(filterPanel()).queryByRole('checkbox', { name: 'Filter by Delivered' })).toBeNull();
    expect(within(filterPanel()).getByRole('checkbox', { name: 'Filter by Clicked' })).toBeTruthy();
    fireEvent.click(within(filterPanel()).getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(4);
    expect(within(filterPanel()).getAllByRole('checkbox').every(control => !(control as HTMLInputElement).checked)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Filter recipients' }).getAttribute('aria-expanded')).toBe('false');
  });
  it('retains rows during refresh, blocks duplicate requests, and applies both metrics and recipient changes', async () => {
    mount(); await screen.findByText('Doris Testing');
    let resolve!: (value: never) => void;
    vi.mocked(campaignsApi.report).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const refresh = screen.getByRole('button', { name: 'Refresh' }); fireEvent.click(refresh); fireEvent.click(refresh);
    expect(screen.getByText('Doris Testing')).toBeTruthy(); expect(campaignsApi.report).toHaveBeenCalledTimes(2); expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status', { name: 'Refreshing recipients' }).querySelector('.animate-spin')).toBeTruthy();
    const next = response(); next.data.recipients = recipients.slice(1); next.data.recipientCount = 3;
    await act(async () => resolve(next as never)); expect(screen.queryByText('Doris Testing')).toBeNull(); expect(screen.getByText('3 of 3 recipients')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Refreshing recipients' })).toBeNull();
    expect((refresh as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows initial skeleton, recoverable errors, and compact recipient/link empty states', async () => {
    let reject!: (value: Error) => void;
    vi.mocked(campaignsApi.report).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; })); mount();
    expect(screen.getByRole('status', { name: 'Loading data' })).toBeTruthy();
    await act(async () => reject(new Error('Report access denied.'))); expect(screen.getByRole('alert').textContent).toContain('Report access denied.');
    vi.mocked(campaignsApi.report).mockResolvedValueOnce({ success: true, data: { ...response().data, recipients: [], topLinks: [], clickedCount: 0, totalClicks: 0, uniqueClicks: 0 } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('No recipients yet.'); expect(screen.getByText('No links have been clicked yet.')).toBeTruthy();
  });
  it('keeps loaded data and exposes refresh failures', async () => {
    mount(); await screen.findByText('Doris Testing'); vi.mocked(campaignsApi.report).mockRejectedValueOnce(new Error('Network unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await screen.findByRole('alert'); expect(screen.getByText('Doris Testing')).toBeTruthy();
  });
  it.each(['Email', 'Sms'])('updates %s from Sending to Sent automatically after provider confirmation', async type => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const first = { ...response().data, type, status: 'sending', recipients: [{ ...recipients[0], deliveryStatus: 'Submitted' }] };
    vi.mocked(campaignsApi.report).mockResolvedValueOnce({ success: true, data: first } as never);
    const { unmount } = render(<CampaignReportView campaign={{ ...campaign, type } as never} onBack={vi.fn()} />);
    await act(async () => {});
    expect(screen.getAllByText('Sending').length).toBeGreaterThan(0);
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: { ...first, status: 'sent', recipients: [{ ...first.recipients[0], deliveryStatus: 'Sent' }] } } as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.queryByText('Sending')).toBeNull();
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    unmount();
  });
  it.each(['Email', 'Sms'])('refreshes %s in place, pauses while hidden, resumes immediately and stops on unmount', async type => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const first = { ...response().data, type, status: 'sent', openedCount: 0, clickedCount: 0, topLinks: [], recipients: [{ ...recipients[0], deliveryStatus: 'Sent', opened: false, clicked: false }] };
    vi.mocked(campaignsApi.report).mockResolvedValue({ success: true, data: first } as never);
    const { unmount } = render(<CampaignReportView campaign={{ ...campaign, type } as never} onBack={vi.fn()} />);
    await act(async () => {});
    expect(campaignsApi.report).toHaveBeenCalledTimes(1);
    let resolve!: (value: never) => void;
    vi.mocked(campaignsApi.report).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByText('Doris Testing')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading data' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Refreshing recipients' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('status', { name: 'Refreshing recipients' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(campaignsApi.report).toHaveBeenCalledTimes(2);
    const updated = { ...response().data, type, status: 'delivered' };
    await act(async () => resolve({ success: true, data: updated } as never));
    expect(screen.getByRole('heading', { name: 'Delivered', level: 2 })).toBeTruthy();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(1);
    if (type === 'Email') {
      expect(screen.getByRole('link', { name: /camxian/ })).toBeTruthy();
      expect(screen.getAllByLabelText('Clicked')).toHaveLength(1);
    }
    hidden = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(7500); });
    expect(campaignsApi.report).toHaveBeenCalledTimes(2);
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(campaignsApi.report).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); document.dispatchEvent(new Event('visibilitychange')); });
    expect(campaignsApi.report).toHaveBeenCalledTimes(3);
  });
});
