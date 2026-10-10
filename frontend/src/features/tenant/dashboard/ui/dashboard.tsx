'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/store/AuthContext';
import { Users, Briefcase, TrendingUp, ArrowUpRight, Zap, RefreshCw, Check, Target, Star, Calendar, ChevronDown, Filter } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from '@/shared/components/charts/ChartComponents';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu';
import DashboardSkeleton from '@/shared/components/dashboard-skeleton';
import { useDashboard } from '../hooks/use-dashboard-report';
import { DASHBOARD_TIMEZONE, DashboardQuerySchema, dashboardPeriod, dashboardFunnelPeriod, dashboardToday, pipelineStageColor, type DashboardQuery, type DashboardReport, type DashboardRange, type FunnelRange } from '@leadcrm/shared';
import { Input } from '@/shared/components/ui/input';
import { toast } from 'sonner';
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

export default function Dashboard({ heading, renderToolbarActions }: {
  heading?: string;
  renderToolbarActions?: (props: { query: DashboardQuery; report: DashboardReport | null; error: string | null; className: string }) => React.ReactNode;
} = {}) {
  const { user } = useAuth();
  const [query, setQuery] = useState<DashboardQuery>({ range: 'thisMonth', revenueInterval: 'month', funnelRange: 'month' });
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });
  const [funnelCustom, setFunnelCustom] = useState(false);
  const [funnelDraft, setFunnelDraft] = useState({ start: '', end: '' });
  const [funnelError, setFunnelError] = useState('');
  const dashboard = useDashboard(query);
  const { report, error, loading, refresh } = dashboard;
  const currency = report?.currency ?? 'PHP';
  const money = (value: number | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  const metric = report?.metrics;
  const pipelineData = report?.distribution.map(row => ({ ...row, value: row.count, color: pipelineStageColor(row) })) ?? [];
  const pipelineValues = report?.distribution.map(row => ({ name: row.name, value: row.value ?? 0, color: pipelineStageColor(row) })) ?? [];
  const interval = query.revenueInterval ?? 'month';
  const intervalLabel = interval[0].toUpperCase() + interval.slice(1);
  const bucketLabel = (value: unknown) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', ...(interval === 'year' ? { year: 'numeric' as const } : interval === 'month' ? { month: 'short' as const, year: 'numeric' as const } : { month: 'short' as const, day: 'numeric' as const }) }).format(new Date(`${String(value)}T12:00:00+08:00`));
  const funnelPeriod = report?.conversion?.period;
  const formatDay = (day: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(`${day}T12:00:00+08:00`));
  const funnelSubtitle = funnelPeriod ? funnelPeriod.range === 'custom'
    ? `Deals created ${formatDay(funnelPeriod.start)} – ${formatDay(funnelPeriod.end)} · Recorded milestones through ${formatDay(funnelPeriod.end)}`
    : `Deals created during the current ${funnelPeriod.range} · Recorded milestones through today` : 'Selected historical creation cohort';
  const statCards = [
    { label: 'Total Revenue', value: money(metric?.totalRevenue), icon: PesoIcon, color: 'blue', trend: `${metric?.won ?? '—'} won · period` },
    { label: 'Forecasted Revenue', value: money(metric?.forecastedRevenue), icon: TrendingUp, color: 'emerald', trend: 'Current open pipeline' },
    { label: 'Active Deals', value: metric?.activeDeals ?? 'Unavailable', icon: Briefcase, color: 'purple', trend: 'Current open pipeline' },
    { label: 'Total Leads', value: metric?.totalLeads ?? 'Unavailable', icon: Users, color: 'orange', trend: 'Current unconverted' },
    { label: 'Win Rate', value: metric?.winRate == null ? 'Unavailable' : `${metric.winRate}%`, icon: Target, color: 'pink', trend: `${metric?.won ?? '—'} won / ${metric?.won == null || metric?.lost == null ? '—' : metric.won + metric.lost} resolved` },
    { label: 'Avg Deal Velocity', value: metric?.averageDealDays == null ? 'Unavailable' : `${metric.averageDealDays} days`, icon: Zap, color: 'indigo', trend: 'Period · creation to won' },
  ];
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
  const handleRefresh = async () => {
    if (loading) return;
    if (await refresh()) toast.success('Dashboard metrics refreshed'); else toast.error('Dashboard could not refresh');
  };
  if (!user) return null;
  if (!report && loading && !error) return <div className="p-4 lg:p-6 space-y-6"><DashboardSkeleton /></div>;
  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="p-4 lg:p-6 space-y-6" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          <span>{heading ? <strong className="text-slate-700 dark:text-slate-300">{heading}</strong> : <>Welcome back, <strong className="text-slate-700 dark:text-slate-300">{user.firstName}</strong></>}</span>
          <DashboardClock />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu><DropdownMenuTrigger className={toolbarButton} aria-label="Dashboard date range" title={ranges.find(range => range.id === query.range)?.label}><Calendar size={14} aria-hidden="true" /><span className="hidden sm:inline">{ranges.find(range => range.id === query.range)?.label}</span><ChevronDown size={12} aria-hidden="true" className="hidden sm:block" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">{ranges.map(range => <DropdownMenuItem key={range.id} onClick={() => selectRange(range.id)}>{range.label}</DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>
          {renderToolbarActions?.({ query, report, error, className: toolbarButton })}
          <button onClick={handleRefresh} disabled={loading} className={toolbarButton} title="Sync Metrics" aria-label={loading ? 'Syncing…' : 'Sync Metrics'}><RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">{loading ? 'Syncing…' : 'Sync Metrics'}</span></button>
        </div>
      </div>
      {custom && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
        <label className="text-xs">Start date<input aria-label="Start date" type="date" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} className="block rounded border bg-transparent p-2 mt-1" /></label>
        <label className="text-xs">End date<input aria-label="End date" type="date" value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} className="block rounded border bg-transparent p-2 mt-1" /></label>
        <button className={button} onClick={applyCustom}>Apply dates</button><button className={button} onClick={() => setCustom(false)}>Cancel</button>
      </div>}
      {error && <div role="alert" className="text-sm text-destructive border border-red-200 rounded-lg p-3">{error} <button onClick={handleRefresh} disabled={loading} className="underline">Retry</button></div>}
      {!report ? <p className="text-sm text-slate-500">Dashboard metrics are unavailable.</p> : <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map(({ label, value, icon: Icon, color, trend }) => <div key={label} role="group" aria-label={label} className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col gap-2 min-w-0">
            <div className="flex min-w-0 items-start justify-between gap-1"><div className={`shrink-0 p-2 rounded-md ${colors[color].bg} ${colors[color].text}`}><Icon size={16} /></div><span className="min-w-0 break-words text-[10px] font-semibold text-slate-500 text-right">{trend}</span></div>
            <div><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">{label}</span><span className="text-base font-bold text-slate-900 dark:text-white tracking-tight mt-0.5 block break-words">{value}</span></div>
          </div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className={`lg:col-span-8 ${card} min-h-[320px]`}>
            <div className="flex shrink-0 flex-wrap items-start justify-between mb-5 gap-2"><ChartHeading title={`Revenue Trend by ${intervalLabel}`} /><div className="flex items-center gap-2"><span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 shrink-0"><ArrowUpRight size={11} />{metric?.won ?? '—'} won deals</span><ChartFilter title="Revenue Trend" options={['Week', 'Month', 'Year']} value={intervalLabel} onSelect={label => setQuery(previous => ({ ...previous, revenueInterval: label.toLowerCase() as DashboardQuery['revenueInterval'] }))} /></div></div>
            {metric?.totalRevenue == null ? <Empty>Revenue unavailable for this scope or incomplete data.</Empty> : <div className="relative flex-1 min-h-[220px]" role="img" aria-label={`Revenue Trend by ${intervalLabel}: ${money(metric.totalRevenue)} for the selected period.`}><div className="absolute inset-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.trend}><CartesianGrid /><XAxis dataKey="name" tickFormatter={bucketLabel} /><YAxis domain={report.trend.every(row => row.revenue >= 0) ? [0, 'auto'] : undefined} tickFormatter={value => money(Number(value))} /><Tooltip formatter={value => money(Number(value))} /><Area dataKey="revenue" name={`Revenue (${currency})`} stroke="#3B82F6" /></AreaChart></ResponsiveContainer></div></div>}
          </div>
          <div className={`lg:col-span-4 ${card} min-h-[320px]`}>
            <div className="mb-4 shrink-0"><h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Zap size={16} className="text-amber-500" />Action Center</h3><p className="text-xs text-slate-500 mt-0.5">Current · Overdue tasks first, hot leads and configured stale deals</p></div>
            {/* Five 6.75rem slots plus four existing gaps; scale with font density. */}
            <div role="region" aria-label="Action Center actions" tabIndex={0} className="h-[21.5rem] lg:h-[36.25rem] shrink-0 min-h-0 space-y-2.5 overflow-y-auto overflow-x-hidden custom-scrollbar [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2">
              {!report.access.tasks && !report.access.leads && !report.access.deals ? <div className="h-full flex"><Empty>No permitted action modules.</Empty></div> : report.pendingActions === 0 ? <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 py-8"><Check size={28} className="text-emerald-500" /><p className="text-sm font-medium text-slate-600 dark:text-slate-300">All caught up!</p><p className="text-xs">No qualifying pending actions.</p></div> : report.actions.map(action => <Link href={action.href} key={`${action.kind}:${action.id}`} title={action.title} className={`block h-[6.75rem] p-3 rounded-xl border ${action.overdue || action.kind === 'lead' ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2`}>
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1 block">{action.overdue ? 'Overdue task' : action.kind === 'lead' ? 'Hot lead' : action.kind === 'deal' ? 'Deal needs attention' : 'Pending task'} · {action.priority}</span><p className="text-sm font-semibold text-slate-800 dark:text-white break-words line-clamp-2">{action.title}</p>{action.dueDate && <p className="text-xs text-slate-500 mt-0.5">Due {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(action.dueDate))}</p>}
              </Link>)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Deals Won vs. Lost" subtitle="Resolved deals in the selected period" />{!report.access.deals ? <Empty>Deal reporting unavailable.</Empty> : <div className="h-[220px]" role="img" aria-label={`${metric?.won} Closed Won and ${metric?.lost} Closed Lost. Resolved deals for the selected period.`}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.trend}><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend /><Bar dataKey="won" name="Closed Won" fill={report.pipeline ? pipelineStageColor(report.pipeline.stages[3]) : undefined} /><Bar dataKey="lost" name="Closed Lost" fill={report.pipeline ? pipelineStageColor(report.pipeline.stages[4]) : undefined} /></BarChart></ResponsiveContainer></div>}</div>
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Pipeline Distribution" subtitle="Current open deals by official stage" />{!report.access.deals ? <Empty>Deal reporting unavailable.</Empty> : metric?.activeDeals === 0 ? <Empty>No open deals.</Empty> : <div className="h-[190px]" role="img" aria-label={`${metric?.activeDeals} active deals. Stage counts and percentages follow.`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pipelineData} innerRadius={60} outerRadius={90} dataKey="value">{pipelineData.map(row => <Cell key={row.id} fill={row.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>}<div className="mt-3 space-y-1.5">{report.distribution.map(row => <div key={row.id} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pipelineStageColor(row) }} />{row.name}: {row.count} ({row.percentage}%)</div>)}</div></div>
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Pipeline Value by Stage" subtitle={`Current open pipeline · ${money(metric?.openPipelineValue)}`} />{metric?.openPipelineValue == null ? <Empty>Pipeline value unavailable.</Empty> : <div className="h-[190px]" role="img" aria-label="Potential value by open stage. Values follow."><ResponsiveContainer width="100%" height="100%"><BarChart data={pipelineValues} layout="vertical"><YAxis dataKey="name" /><XAxis tickFormatter={value => money(Number(value))} /><Tooltip formatter={value => money(Number(value))} /><Bar dataKey="value" name={`Value (${currency})`} data={pipelineValues.map(row => ({ color: row.color }))} /></BarChart></ResponsiveContainer></div>}<div className="mt-3 space-y-1.5 text-[11px] text-slate-500">{report.distribution.map(row => <p key={row.id}>{row.name}: {money(row.value)}</p>)}</div></div>
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
            <ol className="space-y-3">{report.conversion.stages.slice(0, 3).map(stage => <li key={stage.id}><div className="flex justify-between text-xs mb-1"><span>{stage.name}</span><span>{stage.reached} reached</span></div><div className="h-4 rounded bg-slate-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${report.conversion!.cohort ? stage.reached / report.conversion!.cohort * 100 : 0}%`, backgroundColor: pipelineStageColor(stage) }} /></div></li>)}</ol>
            <div className="grid grid-cols-2 gap-3 mt-4">{report.conversion.stages.slice(3).map(stage => <div key={stage.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs"><p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: pipelineStageColor(stage) }} />{stage.name}</p><p className="font-semibold mt-1">{stage.reached} reached</p></div>)}</div>

          </>}</div>
          <div className={`${card} min-h-[300px]`}><ChartHeading title="Sales Leaderboard" subtitle="Period revenue · agent attribution captured at won closure" /><div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">{report.leaderboard.length === 0 ? <Empty>{report.access.deals ? 'No verified eligible sales attribution in this period.' : 'Deal reporting unavailable.'}</Empty> : report.leaderboard.map((agent, index) => <div key={agent.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
            <div className="relative shrink-0"><div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-gray-200 dark:border-white/[0.08] flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">{agent.firstName[0]}{agent.lastName[0]}</div>{index === 0 && <Star size={10} className="absolute -top-1 -right-1 text-amber-500 fill-amber-500" />}</div><div className="flex-1 min-w-0"><p className="text-sm font-medium text-slate-800 dark:text-white truncate">{agent.firstName} {agent.lastName}</p><p className="text-xs text-slate-500">{agent.won} won deals</p></div><p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{money(agent.revenue)}</p>
          </div>)}</div></div>
        </div>
      </>}
    </motion.div>
  );
}
