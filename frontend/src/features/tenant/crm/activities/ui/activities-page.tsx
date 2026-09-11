'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Search, RefreshCw, Phone, Video, Mail,
  MessageSquare, FileText, Zap, GitBranch, Upload,
  ChevronRight, AlertCircle, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';
import { cn } from '@/lib/utils';
import { activitiesService, type ActivityRecord } from '../services/activities.service';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityTypeFilter =
  | 'all'
  | 'call'
  | 'meeting'
  | 'email'
  | 'sms'
  | 'note'
  | 'stage_change'
  | 'workflow'
  | 'task';

type DateRangeFilter = 'all' | 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map an activity type string to an icon component and accent colour. */
function getActivityMeta(type: string): {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  colorClass: string;
  label: string;
} {
  switch (type) {
    case 'call':         return { icon: Phone,        colorClass: 'bg-blue-500/10 text-blue-500',    label: 'Call' };
    case 'meeting':      return { icon: Video,        colorClass: 'bg-violet-500/10 text-violet-500', label: 'Meeting' };
    case 'email':        return { icon: Mail,         colorClass: 'bg-sky-500/10 text-sky-500',       label: 'Email' };
    case 'sms':          return { icon: MessageSquare,colorClass: 'bg-emerald-500/10 text-emerald-500',label: 'SMS' };
    case 'note':         return { icon: FileText,     colorClass: 'bg-amber-500/10 text-amber-500',   label: 'Note' };
    case 'stage_change':
    case 'stage-change': return { icon: GitBranch,    colorClass: 'bg-pink-500/10 text-pink-500',    label: 'Stage Change' };
    case 'workflow':     return { icon: Zap,          colorClass: 'bg-indigo-500/10 text-indigo-500', label: 'Workflow' };
    case 'task':         return { icon: Activity,     colorClass: 'bg-orange-500/10 text-orange-500', label: 'Task' };
    case 'file_upload':
    case 'file-upload':  return { icon: Upload,       colorClass: 'bg-teal-500/10 text-teal-500',    label: 'File Upload' };
    default:             return { icon: Activity,     colorClass: 'bg-slate-500/10 text-slate-500',   label: type };
  }
}

/** Convert a DateRangeFilter to ISO dateFrom / dateTo strings. */
function resolveDateRange(range: DateRangeFilter): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const startOf = (d: Date): Date => { d.setHours(0, 0, 0, 0); return d; };
  const toISO = (d: Date): string => d.toISOString();

  switch (range) {
    case 'today': {
      return { dateFrom: toISO(startOf(new Date(now))), dateTo: toISO(now) };
    }
    case 'yesterday': {
      const s = new Date(now); s.setDate(s.getDate() - 1); startOf(s);
      const e = new Date(s);   e.setHours(23, 59, 59, 999);
      return { dateFrom: toISO(s), dateTo: toISO(e) };
    }
    case 'last_7_days': {
      const s = new Date(now); s.setDate(s.getDate() - 7); startOf(s);
      return { dateFrom: toISO(s), dateTo: toISO(now) };
    }
    case 'last_30_days': {
      const s = new Date(now); s.setDate(s.getDate() - 30); startOf(s);
      return { dateFrom: toISO(s), dateTo: toISO(now) };
    }
    default:
      return {};
  }
}

/** Format a createdAt ISO string as a human-readable relative time. */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days < 7)    return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Derive a navigation href for an activity based on its entity FKs. */
function getActivityHref(activity: ActivityRecord): string | null {
  if (activity.dealId)    return `/crm/deals/${activity.dealId}`;
  if (activity.leadId)    return `/crm/leads/${activity.leadId}`;
  if (activity.accountId) return `/crm/accounts/${activity.accountId}`;
  return null;
}

// ─── Activity card ────────────────────────────────────────────────────────────

interface ActivityCardProps {
  activity:  ActivityRecord;
  onNavigate: (href: string) => void;
}

function ActivityCard({ activity, onNavigate }: ActivityCardProps): React.ReactElement {
  const meta   = getActivityMeta(activity.type);
  const IconEl = meta.icon;
  const href   = getActivityHref(activity);
  const creatorName = `${activity.createdBy.firstName} ${activity.createdBy.lastName}`.trim()
    || activity.createdBy.email;

  return (
    <div className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group">
      {/* Icon */}
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', meta.colorClass)}>
        <IconEl size={14} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{activity.title}</p>
            {activity.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                {activity.description}
              </p>
            )}
          </div>

          {/* Timestamp + navigate */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
              {formatRelativeTime(activity.createdAt)}
            </span>
            {href && (
              <button
                type="button"
                onClick={() => onNavigate(href)}
                aria-label="Open linked record"
                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all rounded cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Footer row: type badge + actor */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className={cn(
            'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded',
            meta.colorClass,
          )}>
            {meta.label}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
            <User size={10} />
            {creatorName}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow(): React.ReactElement {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/[0.05] animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-2/3 bg-slate-100 dark:bg-white/[0.05] rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-slate-100 dark:bg-white/[0.05] rounded animate-pulse" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActivitiesPage(): React.ReactElement {
  const { user } = useAuth();
  const { users }  = useData();
  const router     = useRouter();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]         = useState('');
  const debouncedSearch                     = useDebounce(searchTerm, 300);
  const [typeFilter, setTypeFilter]         = useState<ActivityTypeFilter>('all');
  const [dateRange, setDateRange]           = useState<DateRangeFilter>('all');
  const [selectedUserId, setSelectedUserId] = useState('');

  // ── Data state ────────────────────────────────────────────────────────────
  const [activities, setActivities]   = useState<ActivityRecord[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [totalItems, setTotalItems]   = useState(0);

  // ── Pagination ────────────────────────────────────────────────────────────
  const {
    currentPage, totalPages, pageSize,
    goToPage, setPageSize,
  } = usePagination({
    totalItems,
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50],
    resetDeps: [debouncedSearch, typeFilter, dateRange, selectedUserId],
  });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchActivities = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const dateParams = resolveDateRange(dateRange);
      const res = await activitiesService.getAll({
        page:        currentPage,
        limit:       pageSize,
        ...(typeFilter !== 'all'   ? { type:        typeFilter }      : {}),
        ...(selectedUserId         ? { createdById: selectedUserId }  : {}),
        ...(dateParams.dateFrom    ? { dateFrom:    dateParams.dateFrom } : {}),
        ...(dateParams.dateTo      ? { dateTo:      dateParams.dateTo }   : {}),
      });

      // The PaginatedResponse<T> shape is { data: T[], meta: { total, page, limit, hasMore } }
      const raw = res as unknown as { data?: ActivityRecord[]; meta?: { total?: number } };
      setActivities(raw.data ?? []);
      setTotalItems(raw.meta?.total ?? 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load activities';
      setFetchError(message);
      setActivities([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, typeFilter, dateRange, selectedUserId]);

  useEffect(() => { void fetchActivities(); }, [fetchActivities]);

  // ── Client-side title search (applied to current page) ───────────────────
  // The backend activity endpoint doesn't support a free-text title search,
  // so we filter the current page client-side. For production-scale data,
  // a server-side `search` param can be added to the repository later.
  const filteredActivities = useMemo<ActivityRecord[]>(() => {
    if (!debouncedSearch) return activities;
    const q = debouncedSearch.toLowerCase();
    return activities.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [activities, debouncedSearch]);

  // ── User options (for the assigned-user dropdown) ────────────────────────
  const userOptions = useMemo(
    () => users.map((u) => ({
      value: u.id,
      label: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
    })),
    [users],
  );

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNavigate = useCallback((href: string): void => {
    router.push(href);
  }, [router]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Activity Feed
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            All CRM events across leads, deals, and accounts — newest first.
          </p>
        </div>
        <button
          onClick={() => { void fetchActivities(); toast.success('Refreshed'); }}
          disabled={isLoading}
          aria-label="Refresh activity feed"
          className="flex items-center gap-1.5 h-9 px-3 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={cn(isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-2.5 items-start md:items-center flex-wrap">
        {/* Search */}
        <div className="relative w-full md:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search activities…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/25 placeholder:text-slate-400 text-slate-800 dark:text-white"
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ActivityTypeFilter)}
          aria-label="Filter by activity type"
          className="bg-white dark:bg-[#0c101d] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="note">Note</option>
          <option value="stage_change">Stage Change</option>
          <option value="workflow">Workflow</option>
          <option value="task">Task</option>
        </select>

        {/* Date range */}
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
          aria-label="Filter by date range"
          className="bg-white dark:bg-[#0c101d] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="last_7_days">Last 7 Days</option>
          <option value="last_30_days">Last 30 Days</option>
        </select>

        {/* User filter */}
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          aria-label="Filter by team member"
          className="bg-white dark:bg-[#0c101d] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2 px-3 text-xs font-semibold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
        >
          <option value="">All Team Members</option>
          {userOptions.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>

        {/* Active filter count badge */}
        {(typeFilter !== 'all' || dateRange !== 'all' || selectedUserId || debouncedSearch) && (
          <button
            type="button"
            onClick={() => {
              setTypeFilter('all');
              setDateRange('all');
              setSelectedUserId('');
              setSearchTerm('');
            }}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Activity list ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-gray-200 dark:border-white/[0.05] shadow-sm overflow-hidden">

        {/* Error state */}
        {fetchError && !isLoading && (
          <div className="p-12 text-center space-y-3">
            <AlertCircle size={32} className="mx-auto text-rose-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Failed to load activities
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{fetchError}</p>
            <button
              onClick={() => { void fetchActivities(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && !fetchError && (
          <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !fetchError && filteredActivities.length === 0 && (
          <ActionableEmptyState
            icon={Activity}
            title={
              debouncedSearch || typeFilter !== 'all' || dateRange !== 'all' || selectedUserId
                ? 'No activities match your filters'
                : 'No activities yet'
            }
            description={
              debouncedSearch || typeFilter !== 'all' || dateRange !== 'all' || selectedUserId
                ? 'Try adjusting your search term or clearing the active filters.'
                : 'Activities are logged automatically when leads are created, deals move stages, calls are logged, and more.'
            }
          />
        )}

        {/* Activity list */}
        {!isLoading && !fetchError && filteredActivities.length > 0 && (
          <div
            role="feed"
            aria-label="Activity feed"
            className="divide-y divide-gray-100 dark:divide-white/[0.04]"
          >
            {filteredActivities.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {!fetchError && totalItems > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalItems}
          pageSizeOptions={[10, 25, 50]}
          onPageChange={goToPage}
          onPageSizeChange={setPageSize}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
