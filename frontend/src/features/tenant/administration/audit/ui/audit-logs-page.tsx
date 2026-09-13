'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/store/AuthContext';
import {
  Activity, Search, Download, Calendar,
  User, Globe, Clock, ChevronRight, AlertCircle, FileText,
  TrendingUp, BarChart2, RefreshCw, Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from '@/shared/components/charts/ChartComponents';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { auditApi } from '@/shared/services/audit.api';
import type { AuditLogEntry } from '@/shared/services/audit.api';

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryFilter = 'All' | 'Auth' | 'CRM' | 'System';
type SeverityFilter = 'All' | 'INFO' | 'WARNING' | 'CRITICAL';
type DateRangeFilter = 'All' | 'Today' | 'Yesterday' | 'Last 7 Days' | 'Last 30 Days';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateRange(range: DateRangeFilter): { from?: string; to?: string } {
  const now = new Date();
  const toISO = (d: Date) => d.toISOString();

  switch (range) {
    case 'Today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { from: toISO(start), to: toISO(now) };
    }
    case 'Yesterday': {
      const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
      const end   = new Date(now); end.setDate(end.getDate() - 1);     end.setHours(23, 59, 59, 999);
      return { from: toISO(start), to: toISO(end) };
    }
    case 'Last 7 Days': {
      const start = new Date(now); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
      return { from: toISO(start), to: toISO(now) };
    }
    case 'Last 30 Days': {
      const start = new Date(now); start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0);
      return { from: toISO(start), to: toISO(now) };
    }
    default:
      return {};
  }
}

function mapCategoryToBackend(cat: CategoryFilter): string | undefined {
  switch (cat) {
    case 'Auth':   return 'auth';
    case 'CRM':    return 'crm';
    case 'System': return 'system';
    default:       return undefined;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20';
    case 'WARNING':  return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
    default:         return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
  }
}

function getActionColor(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('created') || lower.includes('create')) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
  if (lower.includes('updated') || lower.includes('update')) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
  if (lower.includes('deleted') || lower.includes('delete') || lower.includes('archived')) return 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('logout')) return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20';
  return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20';
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow(): React.ReactElement {
  return (
    <tr className="border-b border-gray-100 dark:border-white/[0.04]">
      {[1, 2, 3, 4, 5].map((col) => (
        <td key={col} className="p-4">
          <div className="h-4 bg-slate-100 dark:bg-white/[0.05] rounded animate-pulse" style={{ width: col === 4 ? '80%' : col === 1 ? '60%' : '70%' }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AuditLogsPage(): React.ReactElement {
  const { user } = useAuth();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [search, setSearch]                     = useState('');
  const [debouncedSearch, setDebouncedSearch]   = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');
  const [selectedSeverity, setSelectedSeverity] = useState<SeverityFilter>('All');
  const [selectedDateRange, setSelectedDateRange] = useState<DateRangeFilter>('All');

  // ── Data state ──────────────────────────────────────────────────────────────
  const [logs, setLogs]               = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [totalItems, setTotalItems]   = useState(0);

  // ── Inspector state ─────────────────────────────────────────────────────────
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // ── Dark mode detection (DOM-only, no localStorage) ──────────────────────────
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // ── Debounce search (300ms) ──────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Pagination ───────────────────────────────────────────────────────────────
  const {
    currentPage,
    totalPages,
    pageSize,
    goToPage,
    setPageSize,
  } = usePagination({
    totalItems,
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetDeps: [debouncedSearch, selectedCategory, selectedSeverity, selectedDateRange],
  });

  // ── Fetch logs from real API ─────────────────────────────────────────────────
  const fetchLogs = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const { from, to } = getDateRange(selectedDateRange);
      const category = mapCategoryToBackend(selectedCategory);
      const severity = selectedSeverity !== 'All' ? selectedSeverity : undefined;

      const res = await auditApi.list({
        ...(debouncedSearch ? { action: debouncedSearch } : {}),
        ...(category        ? { entityType: category }   : {}),
        ...(severity        ? { severity }               : {}),
        ...(from            ? { from }                   : {}),
        ...(to              ? { to }                     : {}),
        page:  currentPage,
        limit: pageSize,
      });

      const responseData = res as unknown as {
        data?: AuditLogEntry[];
        meta?: { total: number };
      };

      setLogs(responseData.data ?? []);
      setTotalItems(responseData.meta?.total ?? 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load audit logs';
      setFetchError(message);
      setLogs([]);
      setTotalItems(0);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, selectedCategory, selectedSeverity, selectedDateRange, currentPage, pageSize]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // ── Selected log ─────────────────────────────────────────────────────────────
  const selectedLog = useMemo(
    () => logs.find((l) => l.id === selectedLogId) ?? null,
    [logs, selectedLogId],
  );

  // ── Metrics (computed from current page) ─────────────────────────────────────
  const metrics = useMemo(() => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last24h = logs.filter((l) => new Date(l.createdAt) >= oneDayAgo).length;

    const userCounts: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};

    for (const l of logs) {
      const email = l.user?.email ?? 'system';
      userCounts[email] = (userCounts[email] ?? 0) + 1;
      actionCounts[l.action] = (actionCounts[l.action] ?? 0) + 1;
    }

    let topActor = 'N/A';
    let maxActor = 0;
    for (const [email, count] of Object.entries(userCounts)) {
      if (count > maxActor) { maxActor = count; topActor = email; }
    }

    let topAction = 'N/A';
    let maxAction = 0;
    for (const [action, count] of Object.entries(actionCounts)) {
      if (count > maxAction) { maxAction = count; topAction = action; }
    }

    return { last24h, topActor: topActor.split('@')[0] ?? 'N/A', topAction };
  }, [logs]);

  // ── Trend chart data ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const now = new Date();

    interface Bucket { label: string; start: Date; end: Date }
    const buckets: Bucket[] = [];

    const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const fmtHour = (h: number) => {
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
    };

    if (selectedDateRange === 'Today' || selectedDateRange === 'Yesterday') {
      const base = new Date(now);
      if (selectedDateRange === 'Yesterday') base.setDate(base.getDate() - 1);
      base.setHours(0, 0, 0, 0);
      for (let i = 0; i < 12; i++) {
        const start = new Date(base.getTime() + i * 2 * 3600 * 1000);
        const end   = new Date(start.getTime() + 2 * 3600 * 1000 - 1);
        buckets.push({ label: fmtHour(start.getHours()), start, end });
      }
    } else {
      const days = selectedDateRange === 'Last 30 Days' ? 30 : 7;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const start = new Date(d); start.setHours(0, 0, 0, 0);
        const end   = new Date(d); end.setHours(23, 59, 59, 999);
        buckets.push({ label: fmtDate(d), start, end });
      }
    }

    return buckets.map((b) => {
      const bLogs = logs.filter((l) => {
        const t = new Date(l.createdAt);
        return t >= b.start && t <= b.end;
      });
      let authCount = 0; let crmCount = 0; let sysCount = 0;
      for (const l of bLogs) {
        const cat = (l.entityType ?? '').toLowerCase();
        if (cat === 'auth' || l.action.toLowerCase().includes('login') || l.action.toLowerCase().includes('auth')) authCount++;
        else if (['lead', 'contact', 'deal', 'account', 'pipeline'].some((k) => cat.includes(k) || l.action.toLowerCase().includes(k))) crmCount++;
        else sysCount++;
      }
      return { name: b.label, 'Auth Events': authCount, 'CRM Events': crmCount, 'System Events': sysCount, 'Total Activity': bLogs.length };
    });
  }, [logs, selectedDateRange]);

  // ── Distribution chart data ───────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    let authCount = 0; let crmCount = 0; let sysCount = 0; let otherCount = 0;
    for (const l of logs) {
      const cat = (l.entityType ?? '').toLowerCase();
      const act = l.action.toLowerCase();
      if (cat === 'auth' || act.includes('login') || act.includes('auth')) authCount++;
      else if (['lead', 'contact', 'deal', 'account'].some((k) => cat.includes(k) || act.includes(k))) crmCount++;
      else if (cat === 'system' || act.includes('system') || act.includes('workflow') || act.includes('campaign')) sysCount++;
      else otherCount++;
    }
    const data = [
      { name: 'Auth & Access',    value: authCount, fill: '#8b5cf6' },
      { name: 'CRM Activity',     value: crmCount,  fill: '#10b981' },
      { name: 'System Ops',       value: sysCount,  fill: '#3b82f6' },
    ];
    if (otherCount > 0) data.push({ name: 'Others', value: otherCount, fill: '#6366f1' });
    return data;
  }, [logs]);

  // ── CSV export ────────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback((): void => {
    if (logs.length === 0) {
      toast.error('No audit records to export.');
      return;
    }
    const headers = ['ID', 'Timestamp', 'Action', 'Entity Type', 'Entity ID', 'Operator Email', 'IP Address', 'Severity'];
    const rows = logs.map((l) => [
      l.id,
      new Date(l.createdAt).toLocaleString(),
      l.action,
      l.entityType ?? '',
      l.entityId ?? '',
      l.user?.email ?? '',
      l.ipAddress ?? '',
      l.severity,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `leadcrm_audit_trail_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Audit logs exported to CSV');
  }, [logs]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Audit Trail &amp; Activity Log
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleExportCSV}
            disabled={isLoading || logs.length === 0}
            className="flex items-center gap-1.5 h-9 px-3 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Metric Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Recorded Logs',      value: totalItems.toLocaleString(), sub: 'tracked events',    color: 'text-slate-900 dark:text-white' },
          { label: 'Events (Last 24 Hours)',    value: metrics.last24h,             sub: 'recent activities', color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Primary Change Agent',      value: metrics.topActor,            sub: 'user operator',     color: 'text-slate-900 dark:text-white', truncate: true },
          { label: 'Most Frequent Activity',    value: metrics.topAction,           sub: '',                  color: 'text-slate-950 dark:text-slate-200', truncate: true },
        ].map((card) => (
          <div key={card.label} className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">{card.label}</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span
                className={`font-bold ${card.color} ${card.truncate ? 'text-lg truncate max-w-[160px]' : 'text-2xl'}`}
                title={card.truncate ? String(card.value) : undefined}
              >
                {isLoading ? <span className="inline-block w-16 h-6 bg-slate-100 dark:bg-white/5 rounded animate-pulse" /> : card.value}
              </span>
              {card.sub && <span className="text-xs text-slate-400">{card.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts Panel ────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-white/[0.03] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-lg">
              <TrendingUp size={16} />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900 dark:text-white">Activity Volume Trends &amp; Analysis</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Team usage patterns grouped by {selectedDateRange === 'All' ? 'day' : selectedDateRange.toLowerCase()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400 select-none">
            {[
              { label: 'Total Logs',   color: '#3b82f6' },
              { label: 'Auth & Access', color: '#8b5cf6' },
              { label: 'CRM Activity', color: '#10b981' },
            ].map((leg) => (
              <span key={leg.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: leg.color }} />
                {leg.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Area chart */}
          <div className="lg:col-span-8 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Volume Trend Over Time</div>
            <div className="h-[260px] w-full relative min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    {[
                      { id: 'colorTotal', color: '#3b82f6' },
                      { id: 'colorAuth',  color: '#8b5cf6' },
                      { id: 'colorCRM',   color: '#10b981' },
                    ].map(({ id, color }) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)'} />
                  <XAxis dataKey="name" stroke={isDark ? '#475569' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke={isDark ? '#475569' : '#94a3b8'} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-white dark:bg-[#0c1120] border border-slate-200 dark:border-white/[0.08] p-3 rounded-xl shadow-xl space-y-1.5 text-xs">
                          <p className="font-bold text-slate-800 dark:text-slate-100">{label}</p>
                          {payload.map((p, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: String(p.stroke ?? p.fill ?? '#999') }} />
                              <span className="text-slate-500 dark:text-slate-400">{p.name}:</span>
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-200">{p.value}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="Total Activity" stroke="#3b82f6" strokeWidth={2}  fillOpacity={1} fill="url(#colorTotal)" />
                  <Area type="monotone" dataKey="Auth Events"    stroke="#8b5cf6" strokeWidth={1.5} fillOpacity={1} fill="url(#colorAuth)" />
                  <Area type="monotone" dataKey="CRM Events"     stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#colorCRM)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Distribution bar chart */}
          <div className="lg:col-span-4 space-y-2 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-white/[0.04] pt-4 lg:pt-0 lg:pl-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Distribution</span>
              <span className="text-[10px] bg-slate-100 dark:bg-white/[0.04] text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded-full font-mono">
                {logs.length} shown
              </span>
            </div>
            {logs.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center">
                <p className="text-xs text-slate-400">No data for current filters</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="h-[180px] w-full relative min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" stroke={isDark ? '#64748b' : '#475569'} fontSize={10} tickLine={false} axisLine={false} width={90} />
                      <Tooltip
                        cursor={{ fill: 'transparent' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload as { name: string; value: number };
                          return (
                            <div className="bg-white dark:bg-[#0c1120] border border-slate-200 dark:border-white/[0.08] p-2.5 rounded-xl shadow-lg text-xs">
                              <p className="font-bold text-slate-800 dark:text-slate-100">{d.name}</p>
                              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                                Volume: <span className="font-mono font-semibold text-slate-900 dark:text-white">{d.value}</span>
                                {logs.length > 0 && ` (${((d.value / logs.length) * 100).toFixed(1)}%)`}
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                        {categoryData.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 text-[11px] select-none">
                  {categoryData.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.fill }} />
                        {cat.name}
                      </span>
                      <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {cat.value} ({logs.length > 0 ? ((cat.value / logs.length) * 100).toFixed(0) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Logs table area */}
        <div className="lg:col-span-8 space-y-4">
          {/* Controls */}
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            {/* Search */}
            <div className="relative w-full md:max-w-sm">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search actions, emails, entity types…"
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/25 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-800 dark:text-white"
              />
            </div>
            {/* Filters */}
            <div className="flex w-full md:w-auto gap-2 flex-wrap">
              {(
                [
                  {
                    value: selectedCategory,
                    onChange: (v: string) => setSelectedCategory(v as CategoryFilter),
                    options: ['All', 'Auth', 'CRM', 'System'] as CategoryFilter[],
                    labels: { All: 'All Categories', Auth: 'Auth & Access', CRM: 'CRM Activity', System: 'System Ops' },
                  },
                  {
                    value: selectedSeverity,
                    onChange: (v: string) => setSelectedSeverity(v as SeverityFilter),
                    options: ['All', 'INFO', 'WARNING', 'CRITICAL'] as SeverityFilter[],
                    labels: { All: 'All Severities', INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' },
                  },
                  {
                    value: selectedDateRange,
                    onChange: (v: string) => setSelectedDateRange(v as DateRangeFilter),
                    options: ['All', 'Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days'] as DateRangeFilter[],
                    labels: { All: 'All Time', Today: 'Today', Yesterday: 'Yesterday', 'Last 7 Days': 'Last 7 Days', 'Last 30 Days': 'Last 30 Days' },
                  },
                ] as Array<{
                  value: string;
                  onChange: (v: string) => void;
                  options: string[];
                  labels: Record<string, string>;
                }>
              ).map((filter, idx) => (
                <select
                  key={idx}
                  value={filter.value}
                  onChange={(e) => filter.onChange(e.target.value)}
                  className="flex-1 md:flex-none bg-white dark:bg-[#0c101d] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {filter.options.map((opt) => (
                    <option key={opt} value={opt}>{filter.labels[opt] ?? opt}</option>
                  ))}
                </select>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-gray-200 dark:border-white/[0.05] overflow-hidden shadow-sm">
            {fetchError ? (
              <div className="p-12 text-center space-y-3">
                <AlertCircle className="mx-auto text-red-400" size={32} />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Failed to load audit logs</p>
                <p className="text-xs text-slate-400">{fetchError}</p>
                <button
                  onClick={() => void fetchLogs()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw size={12} />
                  Retry
                </button>
              </div>
            ) : (
              <div className="overflow-x-hidden">
                <table className="w-full text-left font-mono border-collapse table-fixed">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.01] text-[9px] sm:text-[10px] uppercase text-slate-500 tracking-wider">
                      <th className="p-4 py-3 font-semibold">Action</th>
                      <th className="p-4 py-3 font-semibold">Operator</th>
                      <th className="p-4 py-3 font-semibold hidden sm:table-cell">IP Address</th>
                      <th className="p-4 py-3 font-semibold">Entity / Details</th>
                      <th className="p-4 py-3 font-semibold">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04] text-[10px] sm:text-[11px] text-slate-700 dark:text-slate-300">
                    {isLoading
                      ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                      : logs.length === 0
                        ? (
                          <tr>
                            <td colSpan={5} className="p-12 text-center">
                              <AlertCircle className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={32} />
                              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No audit logs found</p>
                              <p className="text-xs text-slate-400 mt-1">Try adjusting your filters or date range.</p>
                            </td>
                          </tr>
                        )
                        : logs.map((log) => {
                          const isSelected = selectedLogId === log.id;
                          const email = log.user?.email ?? '';
                          const [emailUser, emailDomain] = email.split('@');
                          return (
                            <tr
                              key={log.id}
                              onClick={() => setSelectedLogId(isSelected ? null : log.id)}
                              className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.01] ${isSelected ? 'bg-blue-500/5 dark:bg-blue-500/[0.02] border-l-2 border-blue-500' : ''}`}
                            >
                              <td className="p-4">
                                <span className={`text-[9px] sm:text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getActionColor(log.action)}`}>
                                  {log.action}
                                </span>
                                {log.severity && log.severity !== 'INFO' && (
                                  <span className={`ml-1.5 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${getSeverityColor(log.severity)}`}>
                                    {log.severity}
                                  </span>
                                )}
                              </td>
                              <td className="p-4" title={email}>
                                <span className="font-semibold break-all">{emailUser ?? '—'}</span>
                                {emailDomain && (
                                  <span className="block text-[7px] sm:text-[8px] text-slate-400 break-all">@{emailDomain}</span>
                                )}
                                <span className="block text-[7px] sm:text-[8px] text-slate-400 font-mono sm:hidden mt-0.5">
                                  IP: {log.ipAddress ?? '—'}
                                </span>
                              </td>
                              <td className="p-4 text-slate-500 dark:text-slate-400 font-mono hidden sm:table-cell">
                                {log.ipAddress ?? '—'}
                              </td>
                              <td className="p-4">
                                {log.entityType && (
                                  <span className="text-[9px] font-semibold text-slate-500 dark:text-slate-400 uppercase">{log.entityType}</span>
                                )}
                                {log.entityId && (
                                  <span className="block text-[8px] tracking-wide font-semibold text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10 px-1.5 py-0.5 rounded mt-0.5 border border-cyan-500/10 truncate max-w-[140px]" title={log.entityId}>
                                    {log.entityId}
                                  </span>
                                )}
                              </td>
                              <td className="p-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleDateString()}{' '}
                                {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                            </tr>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {!fetchError && totalItems > 0 && (
            <div className="mt-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                pageSizeOptions={[10, 25, 50, 100]}
                onPageChange={goToPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </div>

        {/* ── Inspector Panel ────────────────────────────────────────────────── */}
        <div className="lg:col-span-4 h-full">
          <div className="bg-white dark:bg-white/[0.02] p-5 rounded-2xl border border-gray-200 dark:border-white/[0.05] shadow-sm sticky top-24 space-y-4 font-mono">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-white/[0.03]">
              <FileText className="text-blue-500" size={16} />
              <h3 className="font-semibold text-sm text-slate-900 dark:text-white">Audit Log Inspector</h3>
            </div>

            {selectedLog ? (
              <div className="space-y-4 text-xs">
                {/* Event ID */}
                <div className="space-y-1">
                  <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Event Reference ID</p>
                  <p className="font-mono text-slate-800 dark:text-white bg-slate-100 dark:bg-white/5 p-1.5 rounded select-all font-medium border border-slate-200 dark:border-white/[0.05] break-all">
                    {selectedLog.id}
                  </p>
                </div>

                {/* Action */}
                <div className="space-y-1">
                  <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Action</p>
                  <p className="text-slate-850 dark:text-slate-200 font-bold text-sm">{selectedLog.action}</p>
                </div>

                {/* Severity */}
                <div className="space-y-1">
                  <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Severity</p>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getSeverityColor(selectedLog.severity)}`}>
                    <Shield size={10} />
                    {selectedLog.severity}
                  </span>
                </div>

                {/* Entity */}
                {(selectedLog.entityType || selectedLog.entityId) && (
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Entity</p>
                    {selectedLog.entityType && <p className="text-slate-700 dark:text-slate-300 font-semibold">{selectedLog.entityType}</p>}
                    {selectedLog.entityId && (
                      <p className="font-mono text-cyan-600 dark:text-cyan-400 text-[10px] bg-cyan-50 dark:bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/10 select-all break-all">
                        {selectedLog.entityId}
                      </p>
                    )}
                  </div>
                )}

                {/* Changeset */}
                {selectedLog.changeset && typeof selectedLog.changeset === 'object' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-white/[0.03]">
                    <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Changeset</p>
                    <div className="overflow-hidden border border-slate-200 dark:border-white/[0.05] rounded-lg">
                      <table className="w-full text-[10px] font-mono text-left border-collapse">
                        <thead className="bg-slate-50 dark:bg-[#0e1626] text-slate-400">
                          <tr className="border-b border-slate-200 dark:border-white/[0.05]">
                            <th className="p-1 px-2 font-semibold">Field</th>
                            <th className="p-1 px-2 border-l border-slate-200 dark:border-white/[0.05] font-semibold">Before</th>
                            <th className="p-1 px-2 border-l border-slate-200 dark:border-white/[0.05] font-semibold">After</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05] bg-white dark:bg-[#080d19]">
                          {Object.entries(
                            selectedLog.changeset as Record<string, { old?: unknown; before?: unknown; new?: unknown; after?: unknown }>,
                          ).map(([field, delta]) => (
                            <tr key={field} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                              <td className="p-1 px-2 text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[80px]" title={field}>{field}</td>
                              <td className="p-1 px-2 border-l border-slate-200 dark:border-white/[0.05] text-red-500 bg-red-500/5 max-w-[100px] truncate">
                                {delta?.old !== undefined ? String(delta.old) : delta?.before !== undefined ? String(delta.before) : 'null'}
                              </td>
                              <td className="p-1 px-2 border-l border-slate-200 dark:border-white/[0.05] text-green-500 bg-green-500/5 max-w-[100px] truncate">
                                {delta?.new !== undefined ? String(delta.new) : delta?.after !== undefined ? String(delta.after) : 'null'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Operator info */}
                <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <User size={13} className="text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-500 font-semibold">OPERATOR</p>
                      <p className="text-slate-800 dark:text-slate-300 font-semibold truncate">
                        {selectedLog.user
                          ? `${selectedLog.user.firstName} ${selectedLog.user.lastName}`.trim() || selectedLog.user.email
                          : '—'
                        }
                      </p>
                      {selectedLog.user?.email && (
                        <p className="text-slate-500 dark:text-slate-400 text-[9px]">{selectedLog.user.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Globe size={13} className="text-slate-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-500 font-semibold">IP ADDRESS</p>
                      <p className="text-slate-700 dark:text-slate-300 font-mono font-medium">{selectedLog.ipAddress ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock size={13} className="text-slate-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-500 font-semibold">TIMESTAMP</p>
                      <p className="text-slate-700 dark:text-slate-300 font-medium">{new Date(selectedLog.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Raw JSON */}
                <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-white/[0.03]">
                  <p className="font-semibold text-slate-500 uppercase tracking-widest text-[9px]">Structured Metadata</p>
                  <pre className="p-3 bg-[#0a0f1d] text-slate-300 rounded-lg overflow-x-auto text-[10px] font-mono leading-tight max-h-48 border border-white/[0.05]">
                    {JSON.stringify({
                      evt_id:    selectedLog.id,
                      timestamp: selectedLog.createdAt,
                      action:    selectedLog.action,
                      severity:  selectedLog.severity,
                      entity:    { type: selectedLog.entityType, id: selectedLog.entityId },
                      operator:  { id: selectedLog.userId, email: selectedLog.user?.email },
                      client:    { ip: selectedLog.ipAddress },
                      metadata:  selectedLog.metadata ?? null,
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <Activity size={24} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs">Select any log entry to inspect its details, metadata, and changeset.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
