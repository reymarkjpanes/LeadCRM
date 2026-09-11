'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { getTenantCurrency } from '@/shared/utils/currency';
import { reportingApi } from '@/shared/services/reporting.api';
import type {
  DealVelocity,
  TaskCompletion,
  ContactStatusCount,
} from '@/shared/services/reporting.api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from '@/shared/components/charts/ChartComponents';
import { Download, TrendingUp, Trophy, Zap, CheckCircle2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiState<T> {
  data:    T | null;
  loading: boolean;
  error:   string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a 6-month won-deal revenue series from DataContext deals. */
function buildRevenueTrend(
  deals: Array<{ stageId: string; value: number; closedAt?: string | null }>,
  pipelines: Array<{ stages: Array<{ id: string; isWon?: boolean }> }>,
): Array<{ name: string; revenue: number; month: string }> {
  // Resolve which stage IDs are Won across all tenant pipelines
  const wonStageIds = new Set<string>();
  pipelines.forEach((p) => {
    p.stages.forEach((s) => {
      if (s.isWon) wonStageIds.add(s.id);
    });
  });

  const now    = new Date();
  const result = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      name:  d.toLocaleDateString('en-US', { month: 'short' }),
      revenue: 0,
    };
  });

  deals.forEach((deal) => {
    if (!wonStageIds.has(deal.stageId)) return;
    // Use closedAt when available; fall back to creation context via stageId match
    const closedStr = deal.closedAt;
    if (!closedStr) return;
    const closed = new Date(closedStr);
    const key = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2, '0')}`;
    const bucket = result.find((r) => r.month === key);
    if (bucket) bucket.revenue += deal.value ?? 0;
  });

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#0A6EFF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function ReportsPage(): React.ReactElement {
  const { contacts, deals, users, pipelines } = useData();
  const { tenant }          = useAuth();
  const tenantCurrency      = useMemo(() => getTenantCurrency(tenant), [tenant]);
  const currencySymbol      = tenantCurrency.symbol;

  // ── API state ──────────────────────────────────────────────────────────────
  const [velocity, setVelocity]   = useState<ApiState<DealVelocity>>({ data: null, loading: true, error: null });
  const [tasks, setTasks]         = useState<ApiState<TaskCompletion>>({ data: null, loading: true, error: null });
  const [statusApi, setStatusApi] = useState<ApiState<ContactStatusCount[]>>({ data: null, loading: true, error: null });

  const fetchReports = useCallback(async (): Promise<void> => {
    // Fire all three API calls in parallel — non-blocking relative to each other
    const [velocityRes, tasksRes, statusRes] = await Promise.allSettled([
      reportingApi.dealVelocity(),
      reportingApi.taskCompletion(),
      reportingApi.contactStatus(),
    ]);

    setVelocity({
      data:    velocityRes.status === 'fulfilled' ? (velocityRes.value as { data: DealVelocity }).data : null,
      loading: false,
      error:   velocityRes.status === 'rejected'  ? (velocityRes.reason instanceof Error ? velocityRes.reason.message : 'Failed to load') : null,
    });

    setTasks({
      data:    tasksRes.status === 'fulfilled' ? (tasksRes.value as { data: TaskCompletion }).data : null,
      loading: false,
      error:   tasksRes.status === 'rejected'  ? (tasksRes.reason instanceof Error ? tasksRes.reason.message : 'Failed to load') : null,
    });

    setStatusApi({
      data:    statusRes.status === 'fulfilled' ? (statusRes.value as { data: ContactStatusCount[] }).data : null,
      loading: false,
      error:   statusRes.status === 'rejected'  ? (statusRes.reason instanceof Error ? statusRes.reason.message : 'Failed to load') : null,
    });
  }, []);

  useEffect(() => { void fetchReports(); }, [fetchReports]);

  // ── Derived data from DataContext ──────────────────────────────────────────

  /** 6-month revenue trend derived from real closed-won deals */
  const revenueTrendData = useMemo(
    () => buildRevenueTrend(
      deals as Array<{ stageId: string; value: number; closedAt?: string | null }>,
      pipelines as Array<{ stages: Array<{ id: string; isWon?: boolean }> }>,
    ),
    [deals, pipelines],
  );

  /** Pipeline value grouped by stage — from DataContext (already client-side paginated) */
  const pipelineData = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {};
    deals.forEach((deal) => {
      const stageName = deal.stageId.replace('stage_', '').replace(/^\w/, (c) => c.toUpperCase());
      if (!map[stageName]) map[stageName] = { name: stageName, value: 0 };
      map[stageName].value += deal.value ?? 0;
    });
    return Object.values(map);
  }, [deals]);

  /** Contact status from API (richer than DataContext slice); falls back to DataContext */
  const leadStatusData = useMemo(() => {
    if (statusApi.data && statusApi.data.length > 0) {
      return statusApi.data.map((d) => ({ name: d.status, count: d.count }));
    }
    // DataContext fallback while API loads
    const counts: Record<string, number> = {};
    contacts.forEach((c) => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [statusApi.data, contacts]);

  /** Lead source attribution — won deals grouped by source */
  const leadSourceData = useMemo(() => {
    const wonStageIds = new Set<string>(
      pipelines.flatMap((p) =>
        p.stages.filter((s) => (s as { isWon?: boolean }).isWon).map((s) => s.id),
      ),
    );
    const map: Record<string, { name: string; wonValue: number; wonCount: number; totalCount: number }> = {};
    deals.forEach((deal) => {
      const src = (deal as { leadSource?: string }).leadSource || 'Unknown';
      if (!map[src]) map[src] = { name: src, wonValue: 0, wonCount: 0, totalCount: 0 };
      map[src].totalCount++;
      if (wonStageIds.has(deal.stageId)) {
        map[src].wonValue += deal.value ?? 0;
        map[src].wonCount++;
      }
    });
    return Object.values(map).sort((a, b) => b.wonValue - a.wonValue).slice(0, 8);
  }, [deals, pipelines]);

  /** Team leaderboard */
  const userPerformance = useMemo(() => {
    const wonStageIds = new Set<string>(
      pipelines.flatMap((p) =>
        p.stages.filter((s) => (s as { isWon?: boolean }).isWon).map((s) => s.id),
      ),
    );
    return users
      .filter((u) => u.role === 'Sales Rep' || u.role === 'Client Admin')
      .map((user) => {
        const wonDeals = deals.filter(
          (d) => d.assignedUserId === user.id && wonStageIds.has(d.stageId),
        );
        return {
          ...user,
          dealsWon: wonDeals.length,
          revenue:  wonDeals.reduce((acc, d) => acc + (d.value ?? 0), 0),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [users, deals, pipelines]);

  const {
    currentPage, pageSize, totalPages, totalItems, paginateItems, goToPage, setPageSize,
  } = usePagination({
    totalItems:       userPerformance.length,
    initialPageSize:  10,
    resetDeps:        [],
  });

  const paginatedPerformance = paginateItems(userPerformance);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Analytics &amp; Reports
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Sales performance, lead attribution, and team velocity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void fetchReports(); }}
            disabled={velocity.loading || tasks.loading}
            aria-label="Refresh reports"
            className="flex items-center gap-1.5 h-9 px-3 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={cn(velocity.loading && 'animate-spin')} />
            Refresh
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Export CSV"
                  className="h-9 w-9 flex items-center justify-center bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-xs cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <Download size={14} className="text-slate-500 dark:text-slate-400" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Export CSV</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Top charts: Revenue Trend + Pipeline Value ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Revenue Trend */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Revenue Trend</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Won deal revenue — last 6 months</p>
            </div>
            <div className="p-2 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 rounded-md border border-blue-200 dark:border-blue-800/60">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="h-64 relative w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={revenueTrendData} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#0A6EFF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0A6EFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} dy={8} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${currencySymbol}${(v / 1000).toFixed(0)}k`}
                  dx={-8}
                />
                <ChartTooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: 'rgba(255,255,255,0.1)', color: '#f8fafc', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(value: number) => [`${currencySymbol}${value.toLocaleString()}`, 'Revenue']}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#0A6EFF"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRevenue)"
                  activeDot={{ r: 5, fill: '#0A6EFF', stroke: '#0f172a', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pipeline Value by Stage */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Pipeline Value</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Total deal value by stage</p>
            </div>
          </div>
          <div className="h-64 relative w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={pipelineData} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} dy={8} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${currencySymbol}${(v / 1000).toFixed(0)}k`}
                  dx={-8}
                />
                <ChartTooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: 'rgba(255,255,255,0.1)', color: '#f8fafc', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v: number) => [`${currencySymbol}${v.toLocaleString()}`, 'Value']}
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                />
                <Bar dataKey="value" name="Value" fill="#10B981" radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Middle row: Contact Status + Deal Velocity + Task Completion ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Contact Status */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Contact Status</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Current distribution</p>
          </div>
          <div className="h-56 flex items-center justify-center relative w-full min-w-0">
            {leadStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={leadStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="count"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    stroke="none"
                  >
                    {leadStatusData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: 'rgba(255,255,255,0.1)', color: '#f8fafc', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">No contact data</p>
            )}
          </div>
        </div>

        {/* Deal Velocity */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Deal Velocity</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Average time to close</p>
            </div>
            <div className="p-2 bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 rounded-md border border-violet-200 dark:border-violet-800/60">
              <Zap size={16} />
            </div>
          </div>

          {velocity.loading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/50 rounded-lg" />
              ))}
            </div>
          ) : velocity.error ? (
            <div className="flex items-center gap-2 text-xs text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
              <AlertCircle size={14} className="shrink-0" />
              {velocity.error}
            </div>
          ) : velocity.data ? (
            <div className="space-y-3">
              {[
                {
                  label:   'Avg Days to Close (Won)',
                  value:   velocity.data.avgDaysToCloseWon != null ? `${velocity.data.avgDaysToCloseWon}d` : '—',
                  sub:     `${velocity.data.totalWon} won deal${velocity.data.totalWon !== 1 ? 's' : ''}`,
                  color:   'text-emerald-600 dark:text-emerald-400',
                  bgColor: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40',
                  icon:    <CheckCircle2 size={16} className="text-emerald-500" />,
                },
                {
                  label:   'Avg Days to Close (Lost)',
                  value:   velocity.data.avgDaysToCloseLost != null ? `${velocity.data.avgDaysToCloseLost}d` : '—',
                  sub:     `${velocity.data.totalLost} lost deal${velocity.data.totalLost !== 1 ? 's' : ''}`,
                  color:   'text-rose-600 dark:text-rose-400',
                  bgColor: 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/40',
                  icon:    <AlertCircle size={16} className="text-rose-500" />,
                },
                {
                  label:   'Total Closed',
                  value:   String(velocity.data.totalClosed),
                  sub:     'won + lost',
                  color:   'text-slate-900 dark:text-white',
                  bgColor: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700',
                  icon:    <Clock size={16} className="text-slate-400" />,
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${metric.bgColor}`}
                >
                  <div className="shrink-0">{metric.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{metric.label}</p>
                    <p className={`text-lg font-bold leading-tight ${metric.color}`}>{metric.value}</p>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right shrink-0">{metric.sub}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Task Completion */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Task Completion</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Open tasks at a glance</p>
            </div>
            <div className="p-2 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-800/60">
              <CheckCircle2 size={16} />
            </div>
          </div>

          {tasks.loading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800/50 rounded-lg" />
              ))}
            </div>
          ) : tasks.error ? (
            <div className="flex items-center gap-2 text-xs text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-lg p-3">
              <AlertCircle size={14} className="shrink-0" />
              {tasks.error}
            </div>
          ) : tasks.data ? (() => {
            const { total, completed, overdue, pending } = tasks.data;
            const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
            return (
              <div className="space-y-4">
                {/* Completion percentage ring */}
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-100 dark:text-slate-800" />
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke="currentColor" strokeWidth="3"
                        strokeDasharray={`${completionPct} ${100 - completionPct}`}
                        strokeLinecap="round"
                        className="text-emerald-500 transition-all duration-700"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-900 dark:text-white">
                      {completionPct}%
                    </span>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{completed}<span className="text-sm font-normal text-slate-400 dark:text-slate-500">/{total}</span></p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">tasks completed</p>
                  </div>
                </div>

                {/* Breakdown rows */}
                {[
                  { label: 'Pending',  value: pending,  color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
                  { label: 'Overdue',  value: overdue,  color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
                  { label: 'Completed', value: completed, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400 text-xs">{row.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.color}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            );
          })() : null}
        </div>
      </div>

      {/* ── Team Leaderboard ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Team Leaderboard</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Top performers by won revenue</p>
          </div>
          <div className="p-2 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-800/60">
            <Trophy size={16} />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-medium text-xs">Sales Rep</th>
                <th className="px-5 py-3 font-medium text-xs">Deals Won</th>
                <th className="px-5 py-3 font-medium text-xs text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedPerformance.length > 0 ? paginatedPerformance.map((u, i) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-inner',
                        i === 0 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30' :
                        i === 1 ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300/50' :
                        i === 2 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-300/40' :
                                  'bg-blue-50 dark:bg-blue-900/20 text-blue-500 border border-blue-200/40',
                      )}>
                        {(u.firstName?.[0] ?? '?')}{(u.lastName?.[0] ?? '')}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-white text-sm">
                        {u.firstName} {u.lastName}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-full text-xs font-medium">
                      {u.dealsWon}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-semibold text-emerald-600 dark:text-emerald-400 text-right tabular-nums">
                    {currencySymbol}{u.revenue.toLocaleString()}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No performance data available yet. Assign deals to team members to see the leaderboard.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalItems > 0 && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={totalItems}
              pageSizeOptions={[5, 10, 25]}
              onPageChange={goToPage}
              onPageSizeChange={setPageSize}
              isLoading={false}
            />
          </div>
        )}
      </div>

      {/* ── Lead Source Attribution ───────────────────────────────────────────── */}
      {leadSourceData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Lead Source Attribution</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Won deal revenue by lead source</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={leadSourceData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.1)" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${currencySymbol}${(v / 1000).toFixed(0)}k`}
              />
              <ChartTooltip
                formatter={(value: number) => [`${currencySymbol}${value.toLocaleString()}`, 'Won Revenue']}
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: '12px' }}
              />
              <Bar dataKey="wonValue" fill="#0A6EFF" radius={[4, 4, 0, 0]} name="Won Revenue" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {leadSourceData.slice(0, 4).map((src) => (
              <div
                key={src.name}
                className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700/60"
              >
                <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate mb-1">{src.name}</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {currencySymbol}{src.wonValue.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">{src.wonCount} won / {src.totalCount} total</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
