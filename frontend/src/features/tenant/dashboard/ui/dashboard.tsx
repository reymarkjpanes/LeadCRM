'use client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/store/AuthContext';
import { Users, Briefcase, TrendingUp, ArrowUpRight, Zap, RefreshCw, Check, Target, Star, Calendar, ChevronDown, Filter, Layers, Trophy, ChartNoAxesColumnIncreasing, CircleAlert, ListTodo } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from '@/shared/components/charts/ChartComponents';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import DashboardSkeleton from '@/shared/components/dashboard-skeleton';
import { useDashboard } from '../hooks/use-dashboard-report';
import { DASHBOARD_TIMEZONE, DashboardQuerySchema, dashboardPeriod, dashboardFunnelPeriod, dashboardToday, pipelineStageColor, type DashboardQuery, type DashboardReport, type DashboardRange, type FunnelRange } from '@leadcrm/shared';
import { Input } from '@/shared/components/ui/input';
import { Tooltip as ValueTooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shared/components/ui/tooltip';
import { toast } from '@/shared/utils/toast';
import { motion } from 'motion/react';

const ranges: Array<{ id: DashboardRange; label: string }> = [
  { id: 'today', label: 'Today' }, { id: 'last7', label: 'Last 7 Days' }, { id: 'last30', label: 'Last 30 Days' },
  { id: 'thisMonth', label: 'This Month' }, { id: 'lastMonth', label: 'Last Month' }, { id: 'last3', label: 'Last 3 Months' },
  { id: 'last6', label: 'Last 6 Months' }, { id: 'thisYear', label: 'This Year' }, { id: 'custom', label: 'Custom Date Range' },
];
const card = 'bg-white dark:bg-white/[0.02] p-6 rounded-2xl border border-gray-200 dark:border-white/[0.06] shadow-sm flex flex-col min-w-0';
const buttonBase = 'flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/8 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-98 shadow-xs disabled:opacity-50';
const button = `${buttonBase} h-9 px-3`;
const toolbarButton = `${buttonBase} h-11 w-11 justify-center px-0 sm:h-9 sm:w-auto sm:px-3`;
const colors: Record<string, { bg: string; text: string }> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-500' }, emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-500' }, orange: { bg: 'bg-orange-500/10', text: 'text-orange-500' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-500' }, indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-500' },
};
function PesoIcon({ size }: { size: number }) { return <span style={{ fontSize: size, lineHeight: 1, fontWeight: 700 }} aria-hidden="true">₱</span>; }
function ChartHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="mb-4 min-w-0"><h3 className="break-words font-semibold text-slate-900 dark:text-white">{title}</h3>{subtitle && <p className="break-words text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}</div>;
}
function ChartFilter({ title, options, value, onSelect }: { title: string; options: string[]; value: string; onSelect: (value: string) => void }) {
  return <DropdownMenu><DropdownMenuTrigger className={`${button} !px-2 shrink-0`} aria-label={`Filter ${title}`} title={`Filter ${title}`}><Filter size={14} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{options.map(option => <DropdownMenuItem key={option} onClick={() => onSelect(option)}><span className="w-4 shrink-0">{value === option && <Check size={13} aria-label="Selected" />}</span>{option}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-sm text-slate-500 py-6">{children}</div>;
}
function CompactMoney({ value, currency }: { value: number | null | undefined; currency: string }) {
  if (value == null) return <span>Unavailable</span>;
  const exact = new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(value);
  const compact = new Intl.NumberFormat('en-PH', { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value);
  return <TooltipProvider delayDuration={150}><ValueTooltip><TooltipTrigger asChild>
    <span tabIndex={0} aria-label={exact} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">{compact}</span>
  </TooltipTrigger><TooltipContent>{exact}</TooltipContent></ValueTooltip></TooltipProvider>;
}
function countLabel(count: number, singular: string) { return `${count} ${singular}${count === 1 ? '' : 's'}`; }
function initials(name: string) { return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
function ActionCenterList({ children }: { children: React.ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLAnchorElement>(':scope > a')).slice(0, 5);
    if (!items.length) {
      list.style.removeProperty('--action-list-height');
      list.style.removeProperty('--action-list-desktop-height');
      return;
    }
    const measure = () => {
      const top = items[0].getBoundingClientRect().top;
      // Bound the viewport to actual card content, including wrapped titles and gaps.
      for (const [property, count] of [['--action-list-height', 3], ['--action-list-desktop-height', 5]] as const) {
        const last = items[Math.min(count, items.length) - 1];
        list.style.setProperty(property, `${last.getBoundingClientRect().bottom - top}px`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    items.forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, [children]);
  return <div ref={listRef} role="region" aria-label="Action Center actions" tabIndex={0} className="max-h-[var(--action-list-height)] lg:max-h-[var(--action-list-desktop-height)] shrink-0 min-h-0 space-y-2.5 overflow-y-auto overflow-x-hidden custom-scrollbar [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2">{children}</div>;
}
const clockDate = new Intl.DateTimeFormat('en-US', { timeZone: DASHBOARD_TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const clockTime = new Intl.DateTimeFormat('en-GB', { timeZone: DASHBOARD_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function DashboardClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return now && <time dateTime={now.toISOString()} aria-label="Current date and time" className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
    {clockDate.format(now)}, <strong className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{clockTime.format(now)}</strong>
  </time>;
}

export default function Dashboard({ heading, renderToolbarActions, presentation = 'dashboard' }: {
  heading?: string;
  presentation?: 'dashboard' | 'reporting';
  renderToolbarActions?: (props: { query: DashboardQuery; report: DashboardReport | null; error: string | null; loading: boolean; className: string }) => React.ReactNode;
} = {}) {
  const { user } = useAuth();
  const [selectedQuery, setQuery] = useState<DashboardQuery>({ range: 'thisMonth', revenueInterval: 'month', funnelRange: 'month' });
  const query: DashboardQuery = presentation === 'dashboard'
    ? { ...selectedQuery, leadSourceRange: selectedQuery.leadSourceRange ?? 'thisMonth' }
    : { ...selectedQuery, leadSourceRange: undefined, leadSourceStart: undefined, leadSourceEnd: undefined };
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });
  const [funnelCustom, setFunnelCustom] = useState(false);
  const [funnelDraft, setFunnelDraft] = useState({ start: '', end: '' });
  const [funnelError, setFunnelError] = useState('');
  const [sourceCustom, setSourceCustom] = useState(false);
  const [sourceDraft, setSourceDraft] = useState({ start: '', end: '' });
  const [sourceDateError, setSourceDateError] = useState('');
  const dashboard = useDashboard(query);
  const { report, error, loading, sourceLoading, sourceError, refresh } = dashboard;
  const currency = report?.currency ?? 'PHP';
  const money = (value: number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  const axisMoney = (value: unknown) => new Intl.NumberFormat('en-PH', { style: 'currency', currency, notation: 'compact', ...(presentation === 'dashboard' ? { minimumFractionDigits: 0 } : {}), maximumFractionDigits: 1 }).format(Number(value));
  const metric = report?.metrics;
  const pipelineData = report?.distribution.map(row => ({ ...row, value: row.count, color: pipelineStageColor(row) })) ?? [];
  const pipelineValues = report?.distribution.map(row => ({ name: row.name, value: row.value ?? 0, color: pipelineStageColor(row) })) ?? [];
  const interval = query.revenueInterval ?? 'month';
  const intervalLabel = interval[0].toUpperCase() + interval.slice(1);
  const bucketLabel = (value: unknown) => {
    const label = new Intl.DateTimeFormat('en-PH', { timeZone: DASHBOARD_TIMEZONE, ...(interval === 'year' ? { year: 'numeric' as const } : interval === 'month' ? { month: 'short' as const, year: 'numeric' as const } : { month: 'short' as const, day: 'numeric' as const, year: 'numeric' as const }) }).format(new Date(`${String(value)}T12:00:00+08:00`));
    return interval === 'week' ? `Week of ${label}` : label;
  };
  const funnelPeriod = report?.conversion?.period;
  const formatDay = (day: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(`${day}T12:00:00+08:00`));
  const dateRangeLabel = query.range === 'custom' && query.start && query.end
    ? `${formatDay(query.start)} – ${formatDay(query.end)}`
    : ranges.find(range => range.id === query.range)?.label;
  const funnelSubtitle = funnelPeriod ? funnelPeriod.range === 'custom'
    ? `Deals created ${formatDay(funnelPeriod.start)} – ${formatDay(funnelPeriod.end)} · Recorded milestones through ${formatDay(funnelPeriod.end)}`
    : `Deals created during the current ${funnelPeriod.range} · Recorded milestones through today` : 'Selected historical creation cohort';
  const statCards = [
    { label: 'Total Revenue', value: money(metric?.totalRevenue), icon: PesoIcon, color: 'blue', trend: `${metric?.won ?? '—'} won · period` },
    { label: 'Forecasted Revenue', value: money(metric?.forecastedRevenue), icon: TrendingUp, color: 'emerald', trend: 'Current Qualified deals' },
    { label: 'Active Deals', value: metric?.activeDeals ?? 'Unavailable', icon: Briefcase, color: 'purple', trend: 'Current open pipeline' },
    { label: 'Total Leads', value: metric?.totalLeads ?? 'Unavailable', icon: Users, color: 'orange', trend: 'Current unconverted' },
    { label: 'Win Rate', value: metric?.winRate == null ? 'Unavailable' : `${metric.winRate}%`, icon: Target, color: 'pink', trend: `${metric?.currentWon ?? '—'} won / ${metric?.totalDeals ?? '—'} total deals · current` },
    { label: 'Avg Deal Velocity', value: metric?.averageDealDays == null ? 'Unavailable' : `${metric.averageDealDays} days`, icon: Zap, color: 'indigo', trend: 'Period · creation to won' },
  ];
  const dashboardCards = [
    { label: 'Revenue', value: <CompactMoney value={metric?.totalRevenue} currency={currency} />, icon: ChartNoAxesColumnIncreasing, color: 'emerald', context: 'Won revenue in the selected period' },
    { label: 'Forecast', value: <CompactMoney value={metric?.forecastedRevenue} currency={currency} />, icon: TrendingUp, color: 'purple', context: 'Current Qualified deals' },
    { label: 'Open Deals', value: metric?.activeDeals ?? 'Unavailable', icon: Briefcase, color: 'blue', context: 'Current open pipeline' },
    { label: 'Leads', value: metric?.totalLeads ?? 'Unavailable', icon: Users, color: 'orange', context: 'Current unconverted leads' },
    { label: 'Win Rate', value: metric?.winRate == null ? 'Unavailable' : `${metric.winRate}%`, icon: Target, color: 'pink', context: 'Current won deals divided by all current eligible deals' },
  ];
  const openStages = report?.distribution.filter(stage => ['lead', 'contacted', 'qualified'].includes(stage.name.trim().toLowerCase())) ?? [];
  const largestStage = Math.max(0, ...openStages.map(stage => stage.count));
  const actionSummary = report ? [
    report.access.tasks && countLabel(report.actions.filter(action => action.kind === 'task' && action.overdue).length, 'overdue task'),
    report.access.leads && countLabel(report.actions.filter(action => action.kind === 'lead').length, 'hot lead'),
    report.access.deals && countLabel(report.actions.filter(action => action.kind === 'deal').length, 'stale deal'),
  ].filter(Boolean).join(' · ') : '';
  const compactBucketLabel = (value: unknown) => {
    const multipleYears = new Set(report?.trend.map(row => row.name.slice(0, 4))).size > 1;
    return new Intl.DateTimeFormat('en-PH', { timeZone: DASHBOARD_TIMEZONE,
      ...(interval === 'year' ? { year: 'numeric' as const } : { month: 'short' as const, ...(interval === 'week' ? { day: 'numeric' as const } : {}), ...(multipleYears ? { year: '2-digit' as const } : {}) }),
    }).format(new Date(`${String(value)}T12:00:00+08:00`));
  };
  const selectRange = (range: DashboardRange) => {
    if (range === 'custom') {
      const current = dashboardPeriod(query);
      setDraft({ start: current.start, end: current.end }); setCustom(true);
    } else { setQuery(previous => ({ ...previous, range, start: undefined, end: undefined })); setCustom(false); }
  };
  const applyCustom = () => {
    const candidate = { range: 'custom' as const, ...draft };
    const checked = DashboardQuerySchema.safeParse(candidate);
    if (!checked.success) { toast.error('Choose valid start and end dates.'); return; }
    try { dashboardPeriod(checked.data); } catch { toast.error('Choose a reporting period of at most two years.'); return; }
    setQuery(previous => ({ ...previous, ...checked.data })); setCustom(false);
  };
  const selectFunnel = (label: string) => {
    setFunnelError('');
    if (label === 'Custom Range') {
      const current = dashboardFunnelPeriod(query);
      setFunnelDraft({ start: current.start, end: current.end }); setFunnelCustom(true);
    } else { setQuery(previous => ({ ...previous, funnelRange: label.toLowerCase() as FunnelRange, funnelStart: undefined, funnelEnd: undefined })); setFunnelCustom(false); }
  };
  const applyFunnel = () => {
    const candidate: DashboardQuery = { ...query, funnelRange: 'custom', funnelStart: funnelDraft.start, funnelEnd: funnelDraft.end };
    try {
      const checked = DashboardQuerySchema.parse(candidate); dashboardFunnelPeriod(checked);
      setQuery(checked); setFunnelCustom(false); setFunnelError('');
    } catch { setFunnelError('Choose valid historical dates through today, with From no later than To (maximum two years).'); }
  };
  const selectSourceRange = (range: DashboardRange) => {
    setSourceDateError('');
    if (range === 'custom') {
      const current = dashboardPeriod({ range: query.leadSourceRange ?? 'thisMonth', start: query.leadSourceStart, end: query.leadSourceEnd });
      setSourceDraft({ start: current.start, end: current.end }); setSourceCustom(true);
    } else {
      setQuery(previous => ({ ...previous, leadSourceRange: range, leadSourceStart: undefined, leadSourceEnd: undefined }));
      setSourceCustom(false);
    }
  };
  const applySourceDates = () => {
    const candidate: DashboardQuery = { ...query, leadSourceRange: 'custom', leadSourceStart: sourceDraft.start, leadSourceEnd: sourceDraft.end };
    try {
      DashboardQuerySchema.parse(candidate); dashboardPeriod({ range: 'custom', ...sourceDraft });
      setQuery(candidate); setSourceCustom(false); setSourceDateError('');
    } catch { setSourceDateError('Choose valid start and end dates (maximum two years).'); }
  };
  const handleRefresh = async () => {
    if (loading) return;
    if (await refresh()) toast.success('Dashboard metrics refreshed.'); else toast.error('Dashboard could not refresh');
  };
  if (!user) return null;
  if (presentation === 'dashboard' && !report && loading && !error) return <div className="p-4 lg:p-6 space-y-6"><DashboardSkeleton presentation={presentation} /></div>;
  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="p-4 lg:p-6 space-y-6" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          <span>{heading ? <strong className="text-slate-700 dark:text-slate-300">{heading}</strong> : <>Welcome back, <strong className="text-slate-700 dark:text-slate-300">{user.firstName}</strong></>}</span>
          <DashboardClock />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu><DropdownMenuTrigger className={toolbarButton} aria-label="Dashboard date range" title={dateRangeLabel}><Calendar size={14} aria-hidden="true" /><span className="hidden sm:inline">{dateRangeLabel}</span><ChevronDown size={12} aria-hidden="true" className="hidden sm:block" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" focusSelectedItem>
              {ranges.map(range => {
                const selected = query.range === range.id;
                return <DropdownMenuItem key={range.id} role="menuitemradio" aria-checked={selected}
                  className={`focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? 'bg-accent text-accent-foreground' : 'focus:bg-transparent focus:text-inherit'}`}
                  onSelect={() => selectRange(range.id)}>
                  {range.label}
                </DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {renderToolbarActions?.({ query, report, error, loading, className: toolbarButton })}
          <button onClick={handleRefresh} disabled={loading} className={toolbarButton} title="Sync Metrics" aria-label={loading ? 'Syncing…' : 'Sync Metrics'}><RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">{loading ? 'Syncing…' : 'Sync Metrics'}</span></button>
        </div>
      </div>
      {custom && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
        <label className="text-xs">Start date<Input aria-label="Start date" type="date" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} className="block rounded border p-2 mt-1" /></label>
        <label className="text-xs">End date<Input aria-label="End date" type="date" value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} className="block rounded border p-2 mt-1" /></label>
        <button className={button} onClick={applyCustom}>Apply dates</button><button className={button} onClick={() => setCustom(false)}>Cancel</button>
      </div>}
      {error && <div role="alert" className="text-sm text-destructive border border-red-200 rounded-lg p-3">{error} <button onClick={handleRefresh} disabled={loading} className="underline">Retry</button></div>}
      {!report ? loading && !error ? <DashboardSkeleton presentation={presentation} /> : <p className="text-sm text-slate-500">Dashboard metrics are unavailable.</p> : <>
        {report.warnings.length > 0 && <details className="rounded-lg border border-amber-200 dark:border-amber-900/40 p-3 text-xs text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-400">Reporting warnings ({new Set(report.warnings).size})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">{Array.from(new Set(report.warnings)).map(warning => <li key={warning}>{warning}</li>)}</ul>
        </details>}
        {presentation === 'dashboard' ? <>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" aria-label="Dashboard KPIs">
            {dashboardCards.map(({ label, value, icon: Icon, color, context }) => <div key={label} role="group" aria-label={label} className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02] xl:gap-3 xl:p-3.5">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl xl:h-10 xl:w-10 ${colors[color].bg} ${colors[color].text}`}><Icon size={23} aria-hidden="true" /></div>
              <div className="min-w-0"><span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span><span data-metric-value className="mt-1 block break-words text-lg font-bold tracking-tight tabular-nums text-slate-950 dark:text-white xl:text-xl">{value}</span><span className="sr-only">{context}</span></div>
            </div>)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section aria-label="Action Center" className={`${card} !p-4 sm:!p-5 lg:col-span-5 min-h-[280px]`}>
              <div className="mb-4 shrink-0"><h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Zap size={21} className="text-amber-500" aria-hidden="true" />Action Center</h3>{actionSummary && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{actionSummary}</p>}</div>
              <ActionCenterList>
                {!report.access.tasks && !report.access.leads && !report.access.deals ? <Empty>No permitted action modules.</Empty> : report.pendingActions === 0 ? <Empty>No actions require attention.</Empty> : report.actions.map(action => {
                  const urgent = action.overdue || action.kind === 'lead';
                  const ActionIcon = action.kind === 'task' ? ListTodo : Briefcase;
                  return <Link href={action.href} key={`${action.kind}:${action.id}`} title={action.title} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${urgent ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2`}>
                    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${urgent ? 'bg-red-100 text-destructive dark:bg-red-900/30' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>{action.kind === 'lead' ? initials(action.title) : <ActionIcon size={18} />}</span>
                    <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-sm font-semibold text-slate-900 dark:text-white">{action.title}</p><p className={`mt-0.5 break-words text-[11px] ${urgent ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}`}>{action.overdue ? 'Overdue task' : action.kind === 'lead' ? 'Hot lead' : action.kind === 'deal' ? 'Stale deal' : 'Pending task'} · {action.priority}</p>{action.dueDate && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Due {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: DASHBOARD_TIMEZONE }).format(new Date(action.dueDate))}</p>}</div>
                    <CircleAlert size={19} aria-hidden="true" className={`shrink-0 ${urgent ? 'text-destructive' : 'text-amber-500'}`} />
                  </Link>;
                })}
              </ActionCenterList>
            </section>
            <section aria-label="Revenue Trend" className={`${card} !p-4 sm:!p-5 lg:col-span-7 min-h-[280px]`}>
              <div className="mb-4 flex shrink-0 items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><ChartNoAxesColumnIncreasing size={21} className="text-emerald-500" aria-hidden="true" />Revenue Trend</h3><ChartFilter title="Revenue Trend" options={['Week', 'Month', 'Year']} value={intervalLabel} onSelect={label => setQuery(previous => ({ ...previous, revenueInterval: label.toLowerCase() as DashboardQuery['revenueInterval'] }))} /></div>
              {metric?.totalRevenue == null ? <Empty>Revenue unavailable for this scope or incomplete data.</Empty> : metric.totalRevenue === 0 ? <Empty>No won revenue in the selected period.</Empty> : <div className="relative min-h-[220px] flex-1" role="img" aria-label={`Revenue Trend by ${intervalLabel}: ${money(metric.totalRevenue)} for the selected period.`}><div className="absolute inset-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.trend}><CartesianGrid /><XAxis dataKey="name" tickFormatter={compactBucketLabel} /><YAxis domain={[0, 'auto']} tickFormatter={axisMoney} /><Tooltip labelFormatter={bucketLabel} formatter={value => money(Number(value))} /><Area dataKey="revenue" name={`Revenue (${currency})`} stroke="#3B82F6" dot /></AreaChart></ResponsiveContainer></div></div>}
            </section>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section aria-label="Pipeline Overview" className={`${card} !p-4 sm:!p-5 lg:col-span-5`}>
              <h3 className="mb-5 flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Layers size={21} className="text-purple-500" aria-hidden="true" />Pipeline Overview</h3>
              {(!report.access.deals || metric?.activeDeals === null) ? <Empty>Deal reporting unavailable.</Empty> : largestStage === 0 ? <Empty>No open deals.</Empty> : <ul className="space-y-5">{openStages.map(stage => <li key={stage.id} aria-label={stage.name} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">{stage.name}</span><span className="font-bold tabular-nums text-slate-950 dark:text-white"><CompactMoney value={stage.value} currency={currency} /></span>
                <div role="meter" aria-label={`${stage.name} deal count relative to largest stage`} aria-valuemin={0} aria-valuemax={largestStage} aria-valuenow={stage.count} className="h-3 min-w-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${stage.count / largestStage * 100}%`, backgroundColor: pipelineStageColor(stage) }} /></div><span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{stage.count} {stage.count === 1 ? 'deal' : 'deals'}</span>
              </li>)}</ul>}
            </section>
            <section aria-label="Lead Source Performance" className={`${card} !p-4 sm:!p-5 lg:col-span-7`} aria-busy={sourceLoading}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <ChartHeading title="Lead Source Performance" subtitle="Won Deals by Lead Source" />
                <DropdownMenu><DropdownMenuTrigger className={button} aria-label="Lead Source date range"><span>{ranges.find(range => range.id === (query.leadSourceRange ?? 'thisMonth'))?.label}</span><ChevronDown size={12} aria-hidden="true" /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">{ranges.map(range => <DropdownMenuItem key={range.id} onClick={() => selectSourceRange(range.id)}>{range.label}</DropdownMenuItem>)}</DropdownMenuContent>
                </DropdownMenu>
              </div>
              {sourceCustom && <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="min-w-0 text-xs">Start date<Input aria-label="Lead Source start date" type="date" value={sourceDraft.start} onChange={event => setSourceDraft(previous => ({ ...previous, start: event.target.value }))} className="mt-1 min-w-0" /></label>
                  <label className="min-w-0 text-xs">End date<Input aria-label="Lead Source end date" type="date" min={sourceDraft.start} value={sourceDraft.end} onChange={event => setSourceDraft(previous => ({ ...previous, end: event.target.value }))} className="mt-1 min-w-0" /></label>
                </div>
                {sourceDateError && <p role="alert" className="text-xs text-destructive">{sourceDateError}</p>}
                <div className="flex flex-wrap gap-2"><button className={button} onClick={applySourceDates}>Apply source dates</button><button className={button} onClick={() => setSourceCustom(false)}>Cancel</button></div>
              </div>}
              {sourceError ? <div role="alert" className="text-sm text-destructive">{sourceError} <button className="underline" onClick={() => void refresh(true)} disabled={sourceLoading} aria-label="Retry Lead Source Performance">Retry</button></div>
                : sourceLoading && !report.leadSourcePerformance ? <div role="status" aria-label="Loading Lead Source Performance" className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                : !report.access.deals || !report.leadSourcePerformance ? <Empty>Deal reporting unavailable.</Empty>
                : report.leadSourcePerformance.sources.length === 0 ? <Empty>No won deals for this period.</Empty>
                : <>
                  <div role="img" aria-label="Won Deals by Lead Source. Source names and counts follow." style={{ height: Math.max(180, report.leadSourcePerformance.sources.length * 64) }} className="min-w-0">
                    <ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={report.leadSourcePerformance.sources} showValueLabels wrapCategoryLabels><XAxis /><YAxis dataKey="name" /><Tooltip /><Bar dataKey="won" name="Won Deals" fill="#3B82F6" barSize={16} /></BarChart></ResponsiveContainer>
                  </div>
                  <ul className="sr-only" aria-label="Won Deals by Lead Source">{report.leadSourcePerformance.sources.map(source => <li key={source.name}>{source.name}: {source.won} {source.won === 1 ? 'won deal' : 'won deals'}</li>)}</ul>
                </>}
            </section>
          </div>
          {report.access.leaderboard && <section aria-label="Sales Leaderboard" className={`${card} !p-4 sm:!p-5`}>
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Trophy size={21} className="text-amber-500" aria-hidden="true" />Sales Leaderboard</h3>
            {(metric?.unattributedWon ?? 0) > 0 && <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">{metric?.unattributedWon} won deals · {money(metric?.unattributedRevenue)} without verified eligible sales credit</p>}
            {report.leaderboard.length === 0 ? <Empty>{report.access.deals && metric?.activeDeals !== null ? 'No verified eligible sales attribution in this period.' : 'Deal reporting unavailable.'}</Empty> : <ol className="divide-y divide-slate-100 dark:divide-white/[0.06]">{report.leaderboard.map((agent, index) => <li key={agent.id} className="grid min-w-0 grid-cols-[1.5rem_2rem_minmax(0,1fr)] items-center gap-2 py-3 sm:grid-cols-[1.5rem_2rem_minmax(0,1fr)_auto_5rem] sm:gap-3">
              <span aria-label={`Rank ${index + 1}`} className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${index === 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{index + 1}</span><span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{initials(`${agent.firstName} ${agent.lastName}`)}</span><p className="min-w-0 break-words text-sm font-medium text-slate-900 dark:text-white">{agent.firstName} {agent.lastName}</p><div className="col-span-2 col-start-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:contents"><p className="text-base font-bold tabular-nums text-slate-950 dark:text-white sm:text-right"><CompactMoney value={agent.revenue} currency={currency} /></p><p className="text-xs tabular-nums text-slate-500 dark:text-slate-400 sm:text-right">{agent.won} {agent.won === 1 ? 'deal' : 'deals'}</p></div>
            </li>)}</ol>}
          </section>}
        </> : <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map(({ label, value, icon: Icon, color, trend }) => <div key={label} role="group" aria-label={label} className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col gap-2 min-w-0">
            <div className="flex min-w-0 items-start justify-between gap-1"><div className={`shrink-0 p-2 rounded-md ${colors[color].bg} ${colors[color].text}`}><Icon size={16} /></div><span className="min-w-0 break-words text-[10px] font-semibold text-slate-500 text-right">{trend}</span></div>
            <div><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">{label}</span><span className="text-base font-bold text-slate-900 dark:text-white tracking-tight mt-0.5 block break-words">{value}</span></div>
          </div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className={`lg:col-span-8 ${card} min-h-[320px]`}>
            <div className="flex shrink-0 flex-wrap items-start justify-between mb-5 gap-2"><ChartHeading title={`Revenue Trend by ${intervalLabel}`} /><div className="flex items-center gap-2"><span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 shrink-0"><ArrowUpRight size={11} />{metric?.won ?? '—'} won deals</span><ChartFilter title="Revenue Trend" options={['Week', 'Month', 'Year']} value={intervalLabel} onSelect={label => setQuery(previous => ({ ...previous, revenueInterval: label.toLowerCase() as DashboardQuery['revenueInterval'] }))} /></div></div>
            {metric?.totalRevenue == null ? <Empty>Revenue unavailable for this scope or incomplete data.</Empty> : metric.totalRevenue === 0 ? <Empty>No won revenue in the selected period.</Empty> : <div className="relative flex-1 min-h-[220px]" role="img" aria-label={`Revenue Trend by ${intervalLabel}: ${money(metric.totalRevenue)} for the selected period.`}><div className="absolute inset-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.trend}><CartesianGrid /><XAxis dataKey="name" tickFormatter={bucketLabel} /><YAxis domain={[0, 'auto']} tickFormatter={axisMoney} /><Tooltip labelFormatter={bucketLabel} formatter={value => money(Number(value))} /><Area dataKey="revenue" name={`Revenue (${currency})`} stroke="#3B82F6" /></AreaChart></ResponsiveContainer></div></div>}
          </div>
          <div className={`lg:col-span-4 ${card} min-h-[320px]`}>
            <div className="mb-4 shrink-0"><h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Zap size={16} className="text-amber-500" />Action Center</h3><p className="text-xs text-slate-500 mt-0.5">Current · Overdue tasks first, hot leads and configured stale deals</p></div>
            <ActionCenterList>
              {!report.access.tasks && !report.access.leads && !report.access.deals ? <div className="h-full flex"><Empty>No permitted action modules.</Empty></div> : report.pendingActions === 0 ? <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 py-8"><Check size={28} className="text-emerald-500" /><p className="text-sm font-medium text-slate-600 dark:text-slate-300">All caught up!</p><p className="text-xs">No qualifying pending actions.</p></div> : report.actions.map(action => <Link href={action.href} key={`${action.kind}:${action.id}`} title={action.title} className={`block px-3 py-2.5 rounded-xl border ${action.overdue || action.kind === 'lead' ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2`}>
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5 block">{action.overdue ? 'Overdue task' : action.kind === 'lead' ? 'Hot lead' : action.kind === 'deal' ? 'Deal needs attention' : 'Pending task'} · {action.priority}</span><p className="text-sm font-semibold text-slate-800 dark:text-white break-words line-clamp-2">{action.title}</p>{action.dueDate && <p className="text-xs text-slate-500 mt-0.5">Due {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(action.dueDate))}</p>}
              </Link>)}
            </ActionCenterList>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Deals Won vs. Lost" subtitle="Resolved deals in the selected period" />{(!report.access.deals || metric?.activeDeals === null) ? <Empty>Deal reporting unavailable.</Empty> : metric?.won === 0 && metric.lost === 0 ? <Empty>No resolved deals in the selected period.</Empty> : <div className="h-[220px]" role="img" aria-label={`${metric?.won} Closed Deal and ${metric?.lost} Cancelled. Resolved deals for the selected period.`}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.trend}><XAxis dataKey="name" tickFormatter={bucketLabel} /><YAxis /><Tooltip labelFormatter={bucketLabel} /><Legend /><Bar dataKey="won" name="Closed Deal" fill={report.pipeline ? pipelineStageColor(report.pipeline.stages[3]) : undefined} /><Bar dataKey="lost" name="Cancelled" fill={report.pipeline ? pipelineStageColor(report.pipeline.stages[4]) : undefined} /></BarChart></ResponsiveContainer></div>}</div>
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Pipeline Distribution" subtitle="Current open deals by official stage" />{(!report.access.deals || metric?.activeDeals === null) ? <Empty>Deal reporting unavailable.</Empty> : metric?.activeDeals === 0 ? <Empty>No open deals.</Empty> : <div className="h-[190px]" role="img" aria-label={`${metric?.activeDeals} active deals. Stage counts and percentages follow.`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pipelineData} innerRadius={60} outerRadius={90} dataKey="value">{pipelineData.map(row => <Cell key={row.id} fill={row.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>}<div className="mt-3 space-y-1.5">{report.distribution.map(row => <div key={row.id} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pipelineStageColor(row) }} />{row.name}: {row.count} ({row.percentage}%)</div>)}</div></div>
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Pipeline Value by Stage" subtitle={`Current open pipeline · ${money(metric?.openPipelineValue)}`} />{metric?.openPipelineValue == null ? <Empty>Pipeline value unavailable.</Empty> : metric.activeDeals === 0 ? <Empty>No open deals.</Empty> : <div className="h-[190px]" role="img" aria-label="Potential value by open stage. Values follow."><ResponsiveContainer width="100%" height="100%"><BarChart data={pipelineValues}><XAxis dataKey="name" /><YAxis tickFormatter={axisMoney} /><Tooltip formatter={value => money(Number(value))} /><Bar dataKey="value" name={`Value (${currency})`} data={pipelineValues.map(row => ({ color: row.color }))} /></BarChart></ResponsiveContainer></div>}<div className="mt-3 space-y-1.5 text-[11px] text-slate-500 break-words">{report.distribution.map(row => <p key={row.id}>{row.name}: {money(row.value)}</p>)}</div></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${card} min-h-[300px]`}>
            <div className="flex items-start justify-between gap-2"><ChartHeading title="Deal Pipeline Conversion Funnel" subtitle={funnelSubtitle} /><ChartFilter title="Deal Pipeline Conversion Funnel" options={['Week', 'Month', 'Year', 'Custom Range']} value={query.funnelRange === 'custom' ? 'Custom Range' : (query.funnelRange ?? 'month')[0].toUpperCase() + (query.funnelRange ?? 'month').slice(1)} onSelect={selectFunnel} /></div>
            {funnelCustom && <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="min-w-0 text-xs">From Date<Input aria-label="Funnel From Date" type="date" max={funnelDraft.end && funnelDraft.end < dashboardToday() ? funnelDraft.end : dashboardToday()} value={funnelDraft.start} onChange={event => setFunnelDraft(previous => ({ ...previous, start: event.target.value }))} className="mt-1 min-w-0" /></label>
                <label className="min-w-0 text-xs">To Date<Input aria-label="Funnel To Date" type="date" min={funnelDraft.start} max={dashboardToday()} value={funnelDraft.end} onChange={event => setFunnelDraft(previous => ({ ...previous, end: event.target.value }))} className="mt-1 min-w-0" /></label>
              </div>
              {funnelError && <p role="alert" className="text-xs text-destructive">{funnelError}</p>}
              <div className="flex flex-wrap gap-2"><button className={button} onClick={applyFunnel}>Apply funnel dates</button><button className={button} onClick={() => setFunnelCustom(false)}>Cancel</button></div>
            </div>}
            {!report.conversion ? <Empty>Deal history unavailable.</Empty> : <>
            <p className="mb-3 text-xs text-slate-500">{report.conversion.cohort} deals in the creation cohort · Historical milestones, not current stages</p>
            {report.conversion.cohort === 0 && <p className="mb-3 text-xs text-slate-500">No deals created in this cohort.</p>}
            <ol className="space-y-3">{report.conversion.stages.slice(0, 3).map(stage => <li key={stage.id}><div className="flex justify-between text-xs mb-1"><span>{stage.name}</span><span>{stage.reached} reached</span></div><div className="h-4 rounded bg-slate-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${report.conversion!.cohort ? stage.reached / report.conversion!.cohort * 100 : 0}%`, backgroundColor: pipelineStageColor(stage) }} /></div></li>)}</ol>
            <div className="grid grid-cols-2 gap-3 mt-4">{report.conversion.stages.slice(3).map(stage => <div key={stage.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs"><p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: pipelineStageColor(stage) }} />{stage.name}</p><p className="font-semibold mt-1">{stage.reached} reached</p></div>)}</div>
            <div className="mt-3 space-y-1 text-xs text-slate-500">{[
              ['Lead → Contacted', report.conversion.leadToContacted], ['Contacted → Qualified', report.conversion.contactedToQualified],
              ['Qualified → Closed Deal', report.conversion.qualifiedToWon], ['Qualified → Cancelled', report.conversion.qualifiedToLost],
            ].map(([label, rate]) => <p key={label}>{label}: {rate == null ? 'Unavailable' : `${rate}%`}</p>)}</div>
            {report.conversion.missingHistory > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{report.conversion.missingHistory} deals lack recorded starting history. Rates are unavailable; counts show recorded milestones only.</p>}
          </>}</div>
          {report.access.leaderboard && <div className={`${card} min-h-[300px]`}><ChartHeading title="Sales Leaderboard" subtitle={`Period revenue (${currency}) · agent attribution captured at won closure`} />{(metric?.unattributedWon ?? 0) > 0 && <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">{metric?.unattributedWon} won deals · {money(metric?.unattributedRevenue)} without verified eligible sales credit</p>}<div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">{report.leaderboard.length === 0 ? <Empty>{report.access.deals && metric?.activeDeals !== null ? 'No verified eligible sales attribution in this period.' : 'Deal reporting unavailable.'}</Empty> : report.leaderboard.map((agent, index) => <div key={agent.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
            <div className="relative shrink-0"><div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-gray-200 dark:border-white/[0.08] flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">{agent.firstName[0]}{agent.lastName[0]}</div>{index === 0 && <Star size={10} className="absolute -top-1 -right-1 text-amber-500 fill-amber-500" />}</div><div className="flex-1 min-w-[80px]"><p className="text-sm font-medium text-slate-800 dark:text-white break-words">{agent.firstName} {agent.lastName}</p><p className="text-xs text-slate-500">{agent.won} won deals</p></div><p className="ml-auto max-w-full break-words text-sm font-bold text-emerald-600 dark:text-emerald-400">{money(agent.revenue)}</p>
          </div>)}</div></div>}
        </div>
        </>}
      </>}
    </motion.div>
  );
}
