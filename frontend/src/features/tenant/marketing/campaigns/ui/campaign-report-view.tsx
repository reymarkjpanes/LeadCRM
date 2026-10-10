'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Link2, Mail, Send, Target, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { CampaignClickedLink, CampaignRecipient } from '@leadcrm/shared';
import type { Campaign } from '@/store/types';
import { campaignsApi, type CampaignReportResponse } from '@/shared/services/campaigns.api';
import { Card } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { RecordBackButton } from '@/shared/components/crm/record-back-button';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { ModuleFilterRail, type FilterGroup } from '@/shared/components/crm/module-filter-rail';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { AvatarCell } from '@/shared/components/crm/avatar-cell';
import { DataLoadingSkeleton, DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { DataGrid, type DataGridColumnDef } from '@/shared/components/data-grid';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { CampaignStatusBadge, formatCampaignStatus } from './campaign-status-badge';
import { campaignReportCsv } from '../services/campaign-report-export';

const deliveryFilters = ['Delivered', 'Bounced', 'Submitted', 'Sent', 'Failed', 'Pending'];
const engagementFilters = ['Opened', 'Clicked'];
const engagement = (value: boolean, label: string) => <span aria-label={value ? label : `Not ${label.toLowerCase()}`}>
  {value ? <Check size={16} className="text-emerald-600" aria-hidden="true" /> : <span className="text-slate-400" aria-hidden="true">—</span>}
</span>;
const recipientColumns: DataGridColumnDef<CampaignRecipient>[] = [
  { id: 'recipient', header: 'Recipient', accessor: row => row.name, width: 220,
    cell: (_, row) => <AvatarCell name={row.name} initials={row.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')} /> },
  { id: 'email', header: 'Email', accessor: row => row.email || '—', width: 240 },
  { id: 'delivery', header: 'Delivery Status', accessor: row => row.deliveryStatus, width: 150,
    cell: (_, row) => <Badge variant={row.deliveryStatus === 'Delivered' ? 'success' : ['Bounced', 'Failed'].includes(row.deliveryStatus) ? 'destructive' : 'secondary'} title={row.failureReason ?? undefined}>{row.deliveryStatus}</Badge> },
  { id: 'opened', header: 'Opened', accessor: row => row.opened, width: 90, cell: (_, row) => engagement(row.opened, 'Opened') },
  { id: 'clicked', header: 'Clicked', accessor: row => row.clicked, width: 90, cell: (_, row) => engagement(row.clicked, 'Clicked') },
  { id: 'activity', header: 'Last Activity', accessor: row => formatDateTime(row.lastActivity), width: 220 },
  { id: 'actions', header: 'Actions', accessor: () => '', width: 80, cell: (_, row) => <Button variant="ghost" size="icon" disabled={!row.email}
    aria-label={`Copy email for ${row.name}`} title="Copy email" onClick={async () => {
      try { await navigator.clipboard.writeText(row.email || ''); toast.success('Email copied.'); }
      catch { toast.error('Unable to copy email.'); }
    }}><Copy size={14} /></Button> },
];
const linkColumns: DataGridColumnDef<CampaignClickedLink>[] = [
  { id: 'url', header: 'Link URL', accessor: row => row.url, width: 380, cell: (_, row) =>
    <a href={/^https?:\/\//i.test(row.url) ? row.url : undefined} title={row.url} aria-label={row.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 text-blue-600 hover:underline">
      <Link2 size={16} className="shrink-0" aria-hidden="true" /><span className="truncate">{row.url}</span>
    </a> },
  { id: 'total', header: 'Total Clicks', accessor: row => row.uniqueClicks, width: 150 },
];

export function CampaignReportView({ campaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const [report, setReport] = useState<CampaignReportResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [deliveryFilter, setDeliveryFilter] = useState<string[]>([]);
  const [engagementFilter, setEngagementFilter] = useState<string[]>([]);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const fetchReport = useCallback(async (background = false) => {
    if (inFlight.current) { if (!background) setLoading(true); return; }
    inFlight.current = true;
    const sequence = ++request.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    if (!background) setLoading(true);
    setError('');
    try {
      const result = await campaignsApi.report(campaign.id, controller.signal);
      if (sequence === request.current) setReport(result.data);
    } catch (failure) {
      if (sequence === request.current) setError(failure instanceof Error ? failure.message : 'Unable to load campaign report. Please try again.');
    } finally {
      if (sequence === request.current) { inFlight.current = false; setLoading(false); }
    }
  }, [campaign.id]);
  useEffect(() => {
    setReport(null); setSearch(''); setShowFilters(false); setFilterSearch('');
    setDeliveryFilter([]); setEngagementFilter([]); setShowAllLinks(false);
    inFlight.current = false;
    void fetchReport();
    const refresh = () => { if (!document.hidden) void fetchReport(true); };
    const interval = setInterval(refresh, 2500);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      request.current++;
      activeRequest.current?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchReport]);

  const recipients = report?.recipients ?? [];
  const visibleRecipients = useMemo(() => recipients.filter(row => {
    const query = search.trim().toLowerCase();
    return `${row.name} ${row.email || ''} ${row.phone || ''}`.toLowerCase().includes(query) &&
      (!deliveryFilter.length || deliveryFilter.includes(row.deliveryStatus)) &&
      (!engagementFilter.length || engagementFilter.some(value => value === 'Opened' ? row.opened : row.clicked));
  }), [recipients, search, deliveryFilter, engagementFilter]);
  const current = report ?? campaign;
  const status = formatCampaignStatus(current.status);
  const isSms = current.type.toUpperCase() === 'SMS';
  const columns: DataGridColumnDef<CampaignRecipient>[] = isSms ? recipientColumns.filter(c => !['opened', 'clicked'].includes(c.id)).map(c => c.id === 'email' ? { ...c, id: 'phone', header: 'Phone', accessor: row => row.phone || '—' } : c.id === 'actions' ? { ...c, cell: (_, row) => <Button variant="ghost" size="icon" disabled={!row.phone} aria-label={`Copy phone for ${row.name}`} title="Copy phone" onClick={async () => { try { await navigator.clipboard.writeText(row.phone || ''); toast.success('Phone copied.'); } catch { toast.error('Unable to copy phone.'); } }}><Copy size={14} /></Button> } : c) : recipientColumns;
  const filterGroups: FilterGroup[] = [{ id: 'delivery', label: 'Delivery Status', items:
    deliveryFilters.filter(value => !isSms || value !== 'Bounced').map(value => ({ id: value, label: value,
      count: recipients.filter(row => row.deliveryStatus === value).length, isChecked: deliveryFilter.includes(value) })) },
    ...(!isSms ? [{ id: 'engagement', label: 'Engagement', items: engagementFilters.map(value => ({ id: value, label: value,
      count: recipients.filter(row => value === 'Opened' ? row.opened : row.clicked).length, isChecked: engagementFilter.includes(value) })) }] : [])];
  const toggleFilter = (group: string, value: string) => {
    const update = group === 'delivery' ? setDeliveryFilter : setEngagementFilter;
    update(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  };
  const initialLoading = loading && !report;
  const count = report?.recipientCount ?? 0;
  const metrics: { label: string; value: number | string }[] = isSms ? [
    { label: 'Recipients', value: count }, { label: 'Submitted', value: report?.sentCount ?? 0 },
    { label: 'Sent', value: recipients.filter(r => ['Sent', 'Delivered'].includes(r.deliveryStatus)).length },
    { label: 'Delivered', value: report?.deliveredCount ?? 0 },
    { label: 'Failed', value: report?.failedCount ?? 0 },
  ] : [
    { label: 'Recipients', value: count },
    { label: 'Delivered', value: report?.deliveredCount ?? 0 },
    { label: 'Submitted', value: report?.sentCount ?? 0 },
    { label: 'Opened', value: report?.openedCount ?? 0 },
    { label: 'Total Clicks', value: report?.clickedCount ?? 0 },
    { label: 'Bounced', value: report?.bouncedCount ?? 0 },
  ];
  const trackingMessage = report?.trackingStatus === 'draft' ? 'Save and send this draft to begin tracking.'
    : report?.trackingStatus === 'not_sent' ? 'This campaign has not been submitted.'
    : report?.trackingStatus === 'no_links' ? 'This campaign contains no trackable HTTP or HTTPS links.'
    : (report?.clickedCount ?? 0) > 0 ? 'Clicks were recorded, but their destination URLs are unavailable.'
    : 'No links have been clicked yet.';
  function exportReport() {
    if (!report || error) return;
    const filter = [deliveryFilter.length ? `Delivery: ${deliveryFilter.join(' or ')}` : '',
      engagementFilter.length ? `Engagement: ${engagementFilter.join(' or ')}` : ''].filter(Boolean).join('; ') || 'All recipients';
    const url = URL.createObjectURL(new Blob([campaignReportCsv(report, visibleRecipients, { search, filter })], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'campaign-report.csv'; link.click(); URL.revokeObjectURL(url);
  }
  const details = [
    { label: 'Type', value: current.type === 'Sms' ? 'SMS' : current.type, icon: Mail },
    { label: 'Status', value: status, icon: Check },
    { label: 'Target Segment', value: current.targetAudience, icon: Target },
    { label: 'Recipients', value: `${count} recipient${count === 1 ? '' : 's'}`, icon: Users },
    { label: 'Submitted', value: formatDateTime(current.sentAt), icon: Send },
  ];

  return <div className="w-full min-w-0 space-y-6">
    <header className="min-w-0">
      <RecordBackButton label="Campaigns" onClick={onBack} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge className="uppercase">{current.type} campaign</Badge>
        <CampaignStatusBadge status={current.status} />
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{current.name} Report</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Performance overview and recipient activity</p>
        </div>
        <Button variant="outline" size="sm" className="w-8 shrink-0 px-0 sm:w-auto sm:px-3" aria-label="Export report" title="Export report"
          onClick={exportReport} disabled={!report || !!error || loading}><Download size={14} aria-hidden="true" /><span className="hidden sm:inline">Export report</span></Button>
      </div>
    </header>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/20 dark:border-rose-900 dark:text-rose-300">
      <span className="min-w-0 flex-1">{error}{report && ' Previously loaded data is shown.'}</span>
      <Button variant="outline" onClick={() => void fetchReport()} disabled={loading}>Retry</Button>
    </div>}
    {current.submissionInterruptedAt && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:border-amber-900 dark:text-amber-200">Submission was interrupted. Recipients marked as not sent were never submitted. Unconfirmed recipients may have been accepted. Review recipient failure reasons and provider history before sending again; no recipients were automatically retried.</div>}
    {(report || initialLoading) && <>
      <section aria-label="Campaign metrics" aria-busy={initialLoading} className={`grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 ${isSms ? 'xl:grid-cols-5' : 'xl:grid-cols-6'} gap-3`}>
        {metrics.map((metric, index) => <Card key={metric.label} className="min-w-0 rounded-lg p-4 shadow-sm">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{metric.label}</h2>
          {initialLoading ? <div aria-hidden="true" className="h-8 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /> :
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-2xl font-semibold text-slate-900 dark:text-white">{metric.value.toLocaleString()}</span>
              {isSms && index > 0 && typeof metric.value === 'number' && <span className={index === 4 ? 'text-sm text-rose-600' : 'text-sm text-slate-500 dark:text-slate-400'}>{count ? Math.round(metric.value / count * 100) : 0}%</span>}
            </div>}
        </Card>)}
      </section>
      <section aria-labelledby="campaign-details-title">
        <h2 id="campaign-details-title" className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Campaign details</h2>
        <Card className="rounded-lg shadow-none overflow-hidden">
          {initialLoading ? <div aria-hidden="true"><DataLoadingSkeleton rowCount={2} columnCount={3} /></div> :
            <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
              {details.map(({ label, value, icon: Icon }) => <div key={label} className="flex min-w-0 items-start gap-3 border-b border-slate-100 dark:border-slate-800 p-4 xl:border-b-0 xl:border-r last:border-0">
                <span className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2 text-blue-500"><Icon size={17} aria-hidden="true" /></span>
                <div className="min-w-0"><dt className="text-[10px] uppercase text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-1 break-words text-xs text-slate-900 dark:text-white">{value || '—'}</dd></div>
              </div>)}
            </dl>}
        </Card>
      </section>
      <section aria-labelledby="recipients-title" className="min-w-0 space-y-3" aria-busy={loading}>
        <div><h2 id="recipients-title" className="text-sm font-semibold text-slate-900 dark:text-white">Recipient performance</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{initialLoading ? 'Recipient activity' : `${visibleRecipients.length} of ${recipients.length} recipients`}</p></div>
        <ModuleTableToolbar label="Recipients" search={search} onSearch={setSearch} placeholder="Search recipients..." refreshing={loading} onRefresh={() => fetchReport()}
          filter={<FilterButton title="recipients" open={showFilters} active={!!(deliveryFilter.length || engagementFilter.length)} onClick={() => setShowFilters(value => !value)} />} />
        <div className="flex min-w-0 items-start gap-3">
          <ModuleFilterRail showFilters={showFilters} filterGroups={filterGroups} onToggleFilters={() => setShowFilters(false)}
            filterSearchTerm={filterSearch} onFilterSearch={setFilterSearch} onFilterToggle={toggleFilter} totalRecords={recipients.length}
            onClearFilters={() => { setDeliveryFilter([]); setEngagementFilter([]); setFilterSearch(''); setSearch(''); }} />
          <div className="relative min-w-0 flex-1">
            <DataGrid ariaLabel="Recipient performance table" columns={columns} data={visibleRecipients} getRowId={row => row.id} isLoading={initialLoading} height="auto"
              emptyMessage={recipients.length ? 'No recipients match your search and filter.' : 'No recipients yet.'} />
            {loading && !initialLoading && <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-xl bg-background/90">
              <DataLoadingSpinner label="Refreshing recipients" hideLabel />
            </div>}
          </div>
        </div>
      </section>
      {!isSms && <section aria-labelledby="top-links-title" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="top-links-title" className="text-sm font-semibold text-slate-900 dark:text-white">Top Clicked Links</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each recipient counts once per link.</p></div>
          {(report?.topLinks.length ?? 0) > 5 && <Button variant="outline" size="sm" onClick={() => setShowAllLinks(value => !value)}>{showAllLinks ? 'Show Top Five' : 'Show All'}</Button>}</div>
        {initialLoading ? <div aria-hidden="true"><DataLoadingSkeleton rowCount={1} columnCount={2} /></div> : report?.topLinks.length ?
          <DataGrid ariaLabel="Top links clicked table" columns={linkColumns} data={showAllLinks ? report.topLinks : report.topLinks.slice(0, 5)} getRowId={row => row.url} height="auto" /> :
          <Card className="rounded-lg p-4 shadow-none text-xs text-slate-500 dark:text-slate-400">{trackingMessage}</Card>}
      </section>}
    </>}
  </div>;
}
