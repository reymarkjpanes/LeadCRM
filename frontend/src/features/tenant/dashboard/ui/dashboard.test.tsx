import React from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LEAD_SOURCES, type DashboardReport, type DashboardQuery } from '@leadcrm/shared';
import Dashboard from './dashboard';

const mocks = vi.hoisted(() => ({ report: null as DashboardReport | null, query: null as DashboardQuery | null, error: null as string | null, loading: false, refresh: vi.fn(async () => true), charts: [] as any[], success: vi.fn(), failure: vi.fn() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', firstName: 'Sales' } }) }));
vi.mock('../hooks/use-dashboard-report', () => ({ useDashboard: (query: DashboardQuery) => { mocks.query = query; return { report: mocks.report, error: mocks.error, loading: mocks.loading, refresh: mocks.refresh }; } }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: mocks.success, error: mocks.failure } }));
vi.mock('react-chartjs-2', () => ({
  Bar: (props: any) => { mocks.charts.push({ type: 'bar', ...props }); return <canvas />; },
  Line: (props: any) => { mocks.charts.push({ type: 'area', ...props }); return <canvas />; },
  Doughnut: (props: any) => { mocks.charts.push({ type: 'pie', ...props }); return <canvas />; },
}));

beforeEach(() => {
  mocks.charts = [];
  mocks.loading = false; mocks.error = null;
  mocks.refresh.mockResolvedValue(true); mocks.success.mockClear(); mocks.failure.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const stages = ['Lead','Contacted','Qualified','Closed Deal','Cancelled'].map((name, order) => ({
    id: ['lead','contacted','qualified','won','lost'][order], name, order, color: '#123456', probability: null,
    isWon: order === 3, isLost: order === 4,
  }));
  mocks.report = {
    generatedAt: '2020-01-15T04:00:00Z', queryMs: 1, currency: 'PHP', scope: 'organization',
    period: { start: '2020-01-01', end: '2020-01-15', interval: 'month', timezone: 'Asia/Manila' },
    access: { deals: true, leads: true, tasks: true, leaderboard: true }, pipeline: { id: 'sales', name: 'Sales Pipeline', stages },
    metrics: { totalRevenue: 45000, forecastedRevenue: 37000, activeDeals: 3, totalLeads: 1, won: 1, lost: 0,
      currentWon: 2, totalDeals: 25, winRate: 8, averageDealDays: 4, openPipelineValue: 225000,
      forecastMissing: 0, monetaryMissing: 0, currencyExcluded: 0, closingDateMissing: 0, unattributedWon: 1, unattributedRevenue: 1000 },
    trend: [{ name: '2020-01-01', revenue: 45000, won: 1, lost: 0 }],
    distribution: stages.slice(0, 3).map(stage => ({ id: stage.id, name: stage.name, color: stage.color,
      count: stage.id === 'lead' ? 3 : 0, value: stage.id === 'lead' ? 225000 : 0, percentage: stage.id === 'lead' ? 100 : 0 })),
    leadSourcePerformance: { period: { start: '2020-01-01', end: '2020-01-15', timezone: 'Asia/Manila' }, sources: [{ name: 'Referral', won: 12 }, { name: 'Not specified', won: 2 }] },
    conversion: { cohort: 10, missingHistory: 1, period: { start: '2020-01-01', end: '2020-01-15', range: 'month', timezone: 'Asia/Manila', observationCutoff: '2020-01-15T04:00:00Z' },
      stages: stages.map(stage => ({ id: stage.id, name: stage.name, color: stage.color, reached: stage.id === 'lead' ? 9 : 1 })),
      leadToContacted: null, contactedToQualified: null, qualifiedToWon: null, qualifiedToLost: null },
    leaderboard: [{ id: 'agent', firstName: 'Historical', lastName: 'Agent', won: 2, revenue: 44000 }],
    actions: [], pendingActions: 0, warnings: ['Missing historical stage data.', 'Missing historical stage data.'],
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.refresh.mockClear(); });

it('preserves Reports current all-time KPI counts and exact backend forecast, with separate unattributed revenue', () => {
  render(<Dashboard presentation="reporting" />);
  const rate = within(screen.getByRole('group', { name: 'Win Rate' }));
  expect(rate.getByText('8%')).toBeTruthy();
  expect(rate.getByText('2 won / 25 total deals · current')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Forecasted Revenue' })).getByText('₱37,000.00')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Forecasted Revenue' })).getByText('Current Qualified deals')).toBeTruthy();
  expect(screen.getByText('Historical Agent')).toBeTruthy();
  expect(screen.getByText('1 won deals · ₱1,000.00 without verified eligible sales credit')).toBeTruthy();
});
it('exposes unique backend warnings, cohort totals and incomplete history without conflating current stages', () => {
  render(<Dashboard presentation="reporting" />);
  fireEvent.click(screen.getByText('Reporting warnings (1)'));
  expect(screen.getAllByText('Missing historical stage data.')).toHaveLength(1);
  expect(screen.getByText('10 deals in the creation cohort · Historical milestones, not current stages')).toBeTruthy();
  expect(screen.getByText(/1 deals lack recorded starting history/)).toBeTruthy();
  expect(screen.getByText('Qualified → Closed Deal: Unavailable')).toBeTruthy();
  expect(screen.getByText('Lead: 3 (100%)')).toBeTruthy();
});
it('shows backend conversion rates and formats single-bucket revenue and won/lost dates', () => {
  mocks.report!.conversion!.missingHistory = 0;
  mocks.report!.conversion!.qualifiedToWon = 37.5;
  render(<Dashboard presentation="reporting" />);
  expect(screen.getByText('Qualified → Closed Deal: 37.5%')).toBeTruthy();
  const trend = mocks.charts.find(chart => chart.type === 'area');
  const outcomes = mocks.charts.find(chart => chart.type === 'bar' && chart.data.datasets[0].label === 'Closed Deal');
  expect(trend.data.datasets[0].data).toEqual([45000]);
  expect(trend.options.scales.x.offset).toBe(true);
  expect(trend.options.plugins.tooltip.callbacks.title([{ label: '2020-01-01' }])).toBe('Jan 2020');
  expect(outcomes.options.scales.x.ticks.callback(0)).toBe('Jan 2020');
  expect(mocks.charts.find(chart => chart.type === 'bar' && chart.data.datasets[0].label === 'Value (PHP)').options.indexAxis).toBe('x');
});
it('uses meaningful revenue and outcome empty states and unavailable monetary data', () => {
  mocks.report!.metrics.totalRevenue = 0;
  mocks.report!.metrics.won = 0; mocks.report!.metrics.lost = 0;
  mocks.report!.metrics.openPipelineValue = null; mocks.report!.metrics.forecastedRevenue = null;
  render(<Dashboard presentation="reporting" />);
  expect(screen.getByText('No won revenue in the selected period.')).toBeTruthy();
  expect(screen.getByText('No resolved deals in the selected period.')).toBeTruthy();
  expect(screen.getByText('Pipeline value unavailable.')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Forecasted Revenue' })).getByText('Unavailable')).toBeTruthy();
  expect(mocks.charts.filter(chart => chart.type === 'area' || chart.type === 'bar')).toHaveLength(0);
});

it('renders exactly five mapped KPIs and the five requested sections in sample order', () => {
  render(<Dashboard />);
  expect(within(screen.getByLabelText('Dashboard KPIs')).getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Revenue', 'Forecast', 'Open Deals', 'Leads', 'Win Rate']);
  expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Action Center', 'Revenue Trend', 'Pipeline Overview', 'Lead Source Performance', 'Sales Leaderboard']);
  for (const removed of ['Avg Deal Velocity', 'Deals Won vs. Lost', 'Pipeline Distribution', 'Pipeline Value by Stage']) expect(screen.queryByText(removed)).toBeNull();
  expect(within(screen.getByRole('group', { name: 'Revenue' })).getByLabelText('₱45,000.00').textContent).toBe('₱45K');
  expect(within(screen.getByRole('group', { name: 'Forecast' })).getByLabelText('₱37,000.00').textContent).toBe('₱37K');
  expect(within(screen.getByRole('group', { name: 'Open Deals' })).getByText('3')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Leads' })).getByText('1')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Win Rate' })).getByText('100%')).toBeTruthy();
});

it.each([
  { won: 1, lost: 2, expected: '33.3%' },
  { won: 1, lost: 0, expected: '100%' },
  { won: 0, lost: 2, expected: '0%' },
  { won: null, lost: null, expected: 'Unavailable' },
])('shows $expected for $won wins and $lost cancellations even when revenue is zero', ({ won, lost, expected }) => {
  Object.assign(mocks.report!.metrics, { totalRevenue: 0, won, lost });
  render(<Dashboard />);
  expect(within(screen.getByRole('group', { name: 'Win Rate' })).getByText(expected)).toBeTruthy();
});

it('shows exact compact amounts on keyboard focus', async () => {
  render(<Dashboard />);
  const amount = within(screen.getByRole('group', { name: 'Revenue' })).getByLabelText('₱45,000.00');
  expect(amount.tabIndex).toBe(0);
  fireEvent.focus(amount);
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', '₱45,000.00');
});

it('shows distribution counts, saved colors and count-relative widths, excluding money and closed stages', () => {
  mocks.report!.distribution = [
    { id: 'lead', name: 'Lead', color: '#FFCC00', count: 13, value: 132123, percentage: 72.2 },
    { id: 'contacted', name: 'Contacted', color: '#123456', count: 3, value: 37000, percentage: 16.7 },
    { id: 'qualified', name: 'Qualified', color: '#654321', count: 2, value: null, percentage: 11.1 },
    { id: 'won', name: 'Closed Deal', color: null, count: 8, value: 1000, percentage: 0 },
  ];
  render(<Dashboard />);
  const pipeline = within(screen.getByRole('region', { name: 'Pipeline Overview' }));
  expect(pipeline.getAllByRole('listitem').map(row => row.getAttribute('aria-label'))).toEqual(['Lead', 'Contacted', 'Qualified']);
  const lead = within(pipeline.getByRole('listitem', { name: 'Lead' }));
  expect(lead.getByText('13 deals')).toBeTruthy();
  expect(pipeline.queryByText(/₱|Unavailable/)).toBeNull();
  expect((lead.getByRole('meter').firstChild as HTMLElement).style.width).toBe('100%');
  expect((lead.getByRole('meter').firstChild as HTMLElement).style.backgroundColor).toBe('rgb(255, 204, 0)');
  const contacted = pipeline.getByRole('meter', { name: 'Contacted deal count relative to largest stage' });
  expect(parseFloat((contacted.firstChild as HTMLElement).style.width)).toBeCloseTo(3 / 13 * 100);
  expect(within(pipeline.getByRole('listitem', { name: 'Qualified' })).getByText('2 deals')).toBeTruthy();
});

it('shows every configured source in a vertical chart with stable colors, exact counts and horizontal multiline labels', () => {
  render(<Dashboard />);
  const source = within(screen.getByRole('region', { name: 'Lead Source Performance' }));
  expect(source.getByText('Won Deals by Lead Source')).toBeTruthy();
  expect(source.getByRole('list').textContent).toContain('Google Ads: 0 won deals');
  expect(source.getByRole('list').textContent).toContain('Referral: 12 won deals');
  expect(source.getByRole('list').textContent).toContain('Not specified: 2 won deals');
  const chart = mocks.charts.find(chart => chart.type === 'bar');
  expect(chart.options.indexAxis).toBe('x');
  expect(chart.data.labels).toEqual([...LEAD_SOURCES, 'Not specified']);
  expect(chart.data.datasets[0].data).toEqual([0, 12, 0, 0, 0, 0, 0, 0, 0, 2]);
  expect(chart.data.datasets[0].backgroundColor).toEqual(['#2563EB', '#10B981', '#8B5CF6', '#0EA5E9', '#F59E0B', '#EC4899', '#6366F1', '#14B8A6', '#64748B', '#64748B']);
  expect(chart.data.datasets[0].barThickness).toBe(24);
  expect(chart.data.datasets[0].borderRadius).toBe(6);
  expect(chart.options.scales.x.ticks.autoSkip).toBe(false);
  expect(chart.options.scales.x.ticks.maxRotation).toBe(0);
  expect(chart.options.scales.x.ticks.callback(5)).toEqual(['Social Media', 'Advertisement']);
  expect(chart.options.scales.x.ticks.callback(2)).toEqual(['Email', 'Campaign']);
  expect(chart.options.scales.x.ticks.callback(7)).toEqual(['Content', 'Marketing']);
  expect(chart.options.scales.x.ticks.callback(0)).toBe('Google Ads');
  expect(chart.options.scales.y.beginAtZero).toBe(true);
  expect(chart.options.scales.y.ticks.precision).toBe(0);
  expect(chart.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Won Deals' }, parsed: { y: 123456 } })).toBe('Won Deals: 123456');
  expect(chart.options.plugins.legend.display).toBe(false);
  expect(chart.plugins).toHaveLength(1);
  expect(source.getByRole('region', { name: 'Scrollable lead source chart' }).getAttribute('tabindex')).toBe('0');
  expect(source.queryByRole('button', { name: 'Lead Source date range' })).toBeNull();
  for (const removed of ['Conversion Funnel', 'Historical Conversion Rates', 'Current pipeline stage counts']) expect(screen.queryByText(removed)).toBeNull();
});
it('keeps source identities and colors across reordered responses and preserves additional sources once', () => {
  mocks.report!.leadSourcePerformance!.sources = [{ name: 'Website', won: 1 }, { name: 'Partner Event', won: 4 }, { name: 'Others', won: 2 }];
  const view = render(<Dashboard />);
  const original = mocks.charts.find(chart => chart.type === 'bar');
  expect(original.data.labels).toEqual([...LEAD_SOURCES, 'Partner Event']);
  expect(original.data.datasets[0].data).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 2, 4]);
  mocks.charts = [];
  mocks.report!.leadSourcePerformance!.sources = [{ name: 'Partner Event', won: 9 }, { name: 'Others', won: 0 }, { name: 'Website', won: 3 }];
  view.rerender(<Dashboard />);
  const refreshed = mocks.charts.find(chart => chart.type === 'bar');
  expect(refreshed.data.labels).toEqual(original.data.labels);
  expect(refreshed.data.datasets[0].backgroundColor).toEqual(original.data.datasets[0].backgroundColor);
  expect(refreshed.data.datasets[0].data).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0, 9]);
});
it('distinguishes an empty source period from unavailable access', () => {
  mocks.report!.leadSourcePerformance!.sources = [];
  const view = render(<Dashboard />);
  const source = within(screen.getByRole('region', { name: 'Lead Source Performance' }));
  expect(source.getByText('No won deals for this period.')).toBeTruthy();
  expect(mocks.charts.find(chart => chart.type === 'bar').data.labels).toEqual(LEAD_SOURCES);
  expect(mocks.charts.find(chart => chart.type === 'bar').data.datasets[0].data).toEqual(LEAD_SOURCES.map(() => 0));
  mocks.report!.leadSourcePerformance = null; mocks.report!.access.deals = false;
  view.rerender(<Dashboard />);
  expect(source.getByText('Deal reporting unavailable.')).toBeTruthy();
  expect(source.queryByRole('img')).toBeNull();
});
it('accepts the same normalized official stage names as the backend', () => {
  mocks.report!.distribution[0].name = ' lead ';
  render(<Dashboard />);
  expect(within(screen.getByRole('region', { name: 'Pipeline Overview' })).getByText('3 deals')).toBeTruthy();
});

it('keeps action ordering, summaries, links, actual priority and Manila due dates', () => {
  mocks.report!.actions = [
    { id: 'task', kind: 'task', title: 'Call customer', dueDate: '2020-01-14T18:00:00Z', priority: 'High', overdue: true, href: '/operations/taskboard?taskId=task' },
    { id: 'pending', kind: 'task', title: 'Prepare proposal', dueDate: null, priority: 'Low', overdue: false, href: '/operations/taskboard?taskId=pending' },
    { id: 'hot', kind: 'hot-deal', title: 'Doris Deal', stale: true, dueDate: null, priority: 'High', overdue: false, href: '/crm/deals/hot' },
    { id: 'deal', kind: 'deal', title: 'Customer renewal', dueDate: null, priority: 'Medium', overdue: false, href: '/crm/deals/deal' },
  ];
  mocks.report!.pendingActions = 4;
  render(<Dashboard />);
  const actions = within(screen.getByRole('region', { name: 'Action Center' }));
  expect(actions.getByText('1 overdue task · 1 hot deal · 2 stale deals')).toBeTruthy();
  expect(actions.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(mocks.report!.actions.map(action => action.href));
  expect(actions.getByText('Hot deal · Stale deal · High')).toBeTruthy();
  expect(actions.getByText('Pending task · Low')).toBeTruthy();
  expect(actions.getByText('Due Jan 15, 2020')).toBeTruthy();
  expect(actions.queryByText(/Follow-up overdue/)).toBeNull();
});

it('renders backend leaderboard rank, initials, revenue and attributed deal count', () => {
  render(<Dashboard />);
  const board = within(screen.getByRole('region', { name: 'Sales Leaderboard' }));
  expect(board.getByLabelText('Rank 1')).toBeTruthy();
  expect(board.getByText('HA')).toBeTruthy();
  expect(board.getByText('Historical Agent')).toBeTruthy();
  expect(board.getByLabelText('₱44,000.00').textContent).toBe('₱44K');
  expect(board.getByText('2 deals')).toBeTruthy();
  expect(board.getByText('1 won deals · ₱1,000.00 without verified eligible sales credit')).toBeTruthy();
});
it('omits the leaderboard when the backend denies its Group-level access', () => {
  mocks.report!.access.leaderboard = false;
  render(<Dashboard />);
  expect(screen.queryByRole('region', { name: 'Sales Leaderboard' })).toBeNull();
  expect(screen.queryByText('Historical Agent')).toBeNull();
});

it('renders truthful empty states, zero current counts and unavailable rates', () => {
  mocks.report!.metrics.totalRevenue = 0;
  mocks.report!.metrics.forecastedRevenue = null;
  mocks.report!.distribution.forEach(stage => { stage.count = 0; });
  mocks.report!.metrics.currentWon = 0;
  mocks.report!.leaderboard = [];
  mocks.report!.leadSourcePerformance!.sources = [];
  mocks.report!.conversion!.cohort = 0;
  mocks.report!.conversion!.missingHistory = 0;
  mocks.report!.conversion!.stages.forEach(stage => { stage.reached = 0; });
  render(<Dashboard />);
  for (const empty of ['No actions require attention.', 'No won revenue in the selected period.', 'No open deals.', 'No verified eligible sales attribution in this period.']) expect(screen.getByText(empty)).toBeTruthy();
  expect(screen.getByText('No won deals for this period.')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Forecast' })).getByText('Unavailable')).toBeTruthy();
  expect(screen.queryByRole('meter')).toBeNull();
  expect(mocks.charts).toHaveLength(1);
  expect(mocks.charts[0].data.datasets[0].data).toEqual(LEAD_SOURCES.map(() => 0));
});

it('preserves chart report data, compact ticks, exact tooltips and opt-in data points', () => {
  render(<Dashboard />);
  const trend = mocks.charts.find(chart => chart.type === 'area');
  expect(mocks.charts.filter(chart => chart.type === 'area')).toHaveLength(1);
  expect(trend.data.datasets[0].data).toEqual([45000]);
  expect(trend.data.datasets[0].pointRadius).toBe(6);
  expect(trend.options.scales.x.ticks.callback(0)).toBe('Jan 1');
  expect(trend.options.plugins.tooltip.callbacks.title([{ label: '2020-01-01' }])).toBe('Week of Jan 1, 2020');
  expect(trend.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Revenue (PHP)' }, parsed: { y: 45000 } })).toBe('Revenue (PHP): ₱45,000.00');
});

it('preserves Reports global, revenue interval and historical funnel filters', () => {
  render(<Dashboard presentation="reporting" />);
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard date range' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last 3 Months' }));
  fireEvent.click(screen.getByRole('button', { name: 'Filter Revenue Trend' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Week' }));
  fireEvent.click(screen.getByRole('button', { name: 'Filter Deal Pipeline Conversion Funnel' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Year' }));
  expect(mocks.query).toMatchObject({ range: 'last3', revenueInterval: 'week', funnelRange: 'year' });
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard date range' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Custom Date Range' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2020-01-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(mocks.query).toMatchObject({ range: 'custom', start: '2020-01-01', end: '2020-01-02', revenueInterval: 'week', funnelRange: 'year' });
  fireEvent.click(screen.getByRole('button', { name: 'Filter Deal Pipeline Conversion Funnel' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Custom Range' }));
  fireEvent.change(screen.getByLabelText('Funnel From Date'), { target: { value: '2020-01-03' } });
  fireEvent.change(screen.getByLabelText('Funnel To Date'), { target: { value: '2020-01-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply funnel dates' }));
  expect(mocks.query).toMatchObject({ range: 'custom', start: '2020-01-01', end: '2020-01-02', funnelRange: 'custom', funnelStart: '2020-01-03', funnelEnd: '2020-01-04' });
});

it('updates all period sales metrics together while keeping Pipeline Overview live', () => {
  const olderPeriod = mocks.report!;
  mocks.report = {
    ...olderPeriod,
    metrics: { ...olderPeriod.metrics, totalRevenue: 0, won: 0, lost: 0, unattributedWon: 0, unattributedRevenue: 0 },
    trend: [],
    leadSourcePerformance: { ...olderPeriod.leadSourcePerformance!, sources: [] },
    leaderboard: [],
  };
  render(<Dashboard />);
  const range = screen.getByRole('button', { name: 'Dashboard date range' });
  expect(range.getAttribute('title')).toBe('This Month');
  expect(mocks.query).toMatchObject({ range: 'thisMonth', revenueInterval: 'week', leadSourceRange: 'thisMonth' });
  expect(screen.queryByRole('button', { name: 'Filter Revenue Trend' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lead Source date range' })).toBeNull();
  expect(within(screen.getByRole('group', { name: 'Revenue' })).getByText('₱0')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Win Rate' })).getByText('0%')).toBeTruthy();
  expect(screen.getByText('No won revenue in the selected period.')).toBeTruthy();
  expect(screen.getByText('No won deals for this period.')).toBeTruthy();
  expect(screen.getByText('No verified eligible sales attribution in this period.')).toBeTruthy();

  const pipeline = screen.getByRole('region', { name: 'Pipeline Overview' }).innerHTML;
  mocks.report = olderPeriod;
  fireEvent.click(range);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last 3 Months' }));
  expect(mocks.query).toMatchObject({ range: 'last3', revenueInterval: 'month', leadSourceRange: 'last3' });
  expect(within(screen.getByRole('group', { name: 'Revenue' })).getByText('₱45K')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Win Rate' })).getByText('100%')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Revenue Trend by Month: ₱45,000.00 for the selected period.' })).toBeTruthy();
  expect(screen.getByText('Referral: 12 won deals')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Sales Leaderboard' })).getByText('Historical Agent')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Pipeline Overview' }).innerHTML).toBe(pipeline);
});
it.each(['dashboard', 'reporting'] as const)('highlights the applied toolbar range in %s', async presentation => {
  render(<Dashboard presentation={presentation} />);
  const range = screen.getByRole('button', { name: 'Dashboard date range' });
  range.focus();
  fireEvent.click(range);
  const initialMenu = screen.getByRole('menu');
  const thisMonth = within(initialMenu).getByRole('menuitemradio', { name: 'This Month', checked: true });
  expect(Array.from(initialMenu.querySelectorAll('.bg-accent'))).toEqual([thisMonth]);
  expect(initialMenu.querySelector('svg')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(thisMonth));

  fireEvent.click(within(initialMenu).getByRole('menuitemradio', { name: 'This Year', checked: false }));
  expect(range.getAttribute('title')).toBe('This Year');
  fireEvent.keyDown(range, { key: 'ArrowDown' });
  const reopenedMenu = screen.getByRole('menu');
  const thisYear = within(reopenedMenu).getByRole('menuitemradio', { name: 'This Year', checked: true });
  await waitFor(() => expect(document.activeElement).toBe(thisYear));
  fireEvent.keyDown(thisYear, { key: 'Home' });
  const today = within(reopenedMenu).getByRole('menuitemradio', { name: 'Today', checked: false });
  expect(document.activeElement).toBe(today);
  expect(today.classList.contains('focus:bg-transparent')).toBe(true);
  expect(today.classList.contains('focus-visible:ring-2')).toBe(true);
  expect(Array.from(reopenedMenu.querySelectorAll('.bg-accent'))).toEqual([thisYear]);
});

it('highlights custom dates only when applied and clears them on preset selection', () => {
  render(<Dashboard />);
  const range = screen.getByRole('button', { name: 'Dashboard date range' });
  fireEvent.click(range);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Custom Date Range' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(mocks.failure).toHaveBeenCalledWith('Choose valid start and end dates.');
  fireEvent.click(range);
  expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('This Month');
  fireEvent.click(range);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Start date')).toBeNull();

  fireEvent.click(range);
  expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('This Month');
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Custom Date Range' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2020-01-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(mocks.query).toMatchObject({ range: 'custom', start: '2020-01-01', end: '2020-01-31', revenueInterval: 'week', leadSourceRange: 'custom', leadSourceStart: '2020-01-01', leadSourceEnd: '2020-01-31' });
  expect(range.getAttribute('title')).toContain('2020');
  expect(screen.queryByLabelText('Start date')).toBeNull();
  fireEvent.click(range);
  const applied = screen.getByRole('menuitemradio', { name: 'Custom Date Range', checked: true });
  expect(applied.classList.contains('bg-accent')).toBe(true);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last Month' }));
  expect(mocks.query).toMatchObject({ range: 'lastMonth', start: undefined, end: undefined, leadSourceRange: 'lastMonth', leadSourceStart: undefined, leadSourceEnd: undefined });
  expect(range.getAttribute('title')).toBe('Last Month');
});

it('keeps source data and disables Sync Metrics while loading', () => {
  mocks.report!.conversion = null;
  mocks.loading = true;
  render(<Dashboard />);
  expect(screen.queryByText('Deal history unavailable.')).toBeNull();
  expect(screen.getByText('Referral: 12 won deals')).toBeTruthy();
  const sync = screen.getByRole('button', { name: 'Syncing…' }) as HTMLButtonElement;
  expect(sync.disabled).toBe(true);
  fireEvent.click(sync);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('uses Sync Metrics and reports refresh success or failure', async () => {
  render(<Dashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync Metrics' }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Dashboard metrics refreshed.'));
  mocks.refresh.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Sync Metrics' }));
  await waitFor(() => expect(mocks.failure).toHaveBeenCalledWith('Dashboard could not refresh'));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it('uses the simplified loading skeleton and preserves permission-based unavailable states', () => {
  mocks.report = null; mocks.loading = true;
  const view = render(<Dashboard />);
  expect(screen.getByLabelText('Loading Dashboard')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard date range' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Last Month' }));
  expect(mocks.query).toMatchObject({ range: 'lastMonth', leadSourceRange: 'lastMonth' });
  mocks.loading = false; mocks.error = 'Your reporting access changed.';
  view.rerender(<Dashboard />);
  expect(screen.getByRole('alert').textContent).toContain('Your reporting access changed.');
  expect(screen.queryByRole('group')).toBeNull();
});

it('keeps the Reports toolbar mounted and passes loading through initial and cached refreshes', () => {
  const report = mocks.report;
  const actions = ({ loading }: { loading: boolean }) => <button disabled={loading}>Export fixture</button>;
  mocks.report = null; mocks.loading = true;
  const view = render(<Dashboard presentation="reporting" heading="Analytics & Reports" renderToolbarActions={actions} />);
  expect(screen.getByText('Analytics & Reports')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export fixture' })).toHaveProperty('disabled', true);
  expect(screen.queryByText('Dashboard metrics are unavailable.')).toBeNull();
  mocks.report = report;
  view.rerender(<Dashboard presentation="reporting" renderToolbarActions={actions} />);
  expect(screen.getByRole('button', { name: 'Export fixture' })).toHaveProperty('disabled', true);
  mocks.loading = false;
  view.rerender(<Dashboard presentation="reporting" renderToolbarActions={actions} />);
  expect(screen.getByRole('button', { name: 'Export fixture' })).toHaveProperty('disabled', false);
});
