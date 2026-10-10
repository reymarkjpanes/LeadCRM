'use client';

import React from 'react';
import { RefreshCw, Plus, FilterX, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import type { PermissionKey } from '@leadcrm/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColumnSkeletonProps {
  /** Number of skeleton columns to render */
  columnCount?: number;
  /** Optional className */
  className?: string;
}

interface RowSkeletonProps {
  /** Number of skeleton rows to render */
  rowCount?: number;
  /** Number of columns to render per row */
  columnCount?: number;
  /** Row height in pixels */
  rowHeight?: number;
  /** Optional className */
  className?: string;
}

interface EmptyFilteredStateProps {
  /** Description of the active filter that produced zero results */
  activeFilterDescription?: string;
  /** Callback to clear all filters */
  onClearFilters: () => void;
  /** Optional className */
  className?: string;
}

interface EmptyTotalStateProps {
  /** Module name for contextual description (e.g. "leads", "contacts") */
  moduleName: string;
  /** Module description for first-use guidance */
  moduleDescription?: string;
  /** Callback to create a new record */
  onCreateRecord: () => void;
  /** Permission key for create action (RBAC-gated) */
  createPermission: PermissionKey;
  /** Optional className */
  className?: string;
}

interface ErrorStateProps {
  /** Error message to display */
  message?: string;
  /** Retry callback */
  onRetry: () => void;
  /** Optional className */
  className?: string;
}

// ── Column Preferences Loading Skeleton ───────────────────────────────────────

/**
 * ColumnPreferencesLoading — animated skeleton shown while column preferences load.
 * Renders in the table content area; toolbar remains interactive.
 *
 * Requirements: 9.1
 */
export function ColumnPreferencesLoading({
  columnCount = 5,
  className,
}: ColumnSkeletonProps): React.ReactElement {
  return (
    <div className={cn('w-full rounded-xl border border-[#E4E9F0] dark:border-slate-700 overflow-hidden', className)}>
      {/* Header skeleton */}
      <div className="flex items-center h-[44px] bg-[#F6F8FB] dark:bg-slate-800/60 border-b border-[#E4E9F0] dark:border-slate-700 px-3 gap-3">
        <div className="w-3.5 h-3.5 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
        {Array.from({ length: columnCount }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"
            style={{ width: `${60 + Math.random() * 60}px` }}
          />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 6 }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center h-[52px] border-b border-[#E4E9F0] dark:border-slate-700 px-3 gap-3"
        >
          <div className="w-3.5 h-3.5 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          {Array.from({ length: columnCount }).map((_, colIdx) => (
            <div
              key={colIdx}
              className="h-3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse"
              style={{ width: `${50 + Math.random() * 80}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Data Loading Skeleton ─────────────────────────────────────────────────────

/**
 * DataLoadingSkeleton — row-skeleton loading state preserving header + column layout.
 * Used while module data is being fetched.
 *
 * Requirements: 9.2
 */
export function DataLoadingSkeleton({
  rowCount = 8,
  columnCount = 5,
  rowHeight = 52,
  className,
}: RowSkeletonProps): React.ReactElement {
  return (
    <div className={cn('w-full', className)}>
      {Array.from({ length: rowCount }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center border-b border-[#E4E9F0] dark:border-slate-700 px-3 gap-3"
          style={{ height: `${rowHeight}px` }}
        >
          {/* Checkbox placeholder */}
          <div className="w-3.5 h-3.5 rounded bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0" />
          {/* Column cells */}
          {Array.from({ length: columnCount }).map((_, colIdx) => (
            <div
              key={colIdx}
              className="flex-1 min-w-0"
            >
              <div
                className="h-3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse"
                style={{ width: `${40 + Math.random() * 50}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Empty Filtered State ──────────────────────────────────────────────────────

/**
 * EmptyFilteredState — shown when filters return zero results but module has records.
 * Displays message naming the active filter and a clear-filters button.
 *
 * Requirements: 9.3
 */
export function EmptyFilteredState({
  activeFilterDescription,
  onClearFilters,
  className,
}: EmptyFilteredStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4',
        className,
      )}
    >
      <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        <FilterX size={20} className="text-[#5A6B85] dark:text-slate-400" />
      </div>
      <h3 className="text-[14px] font-semibold text-[#0F172A] dark:text-white mb-1">
        No records found
      </h3>
      <p className="text-[13px] text-[#5A6B85] dark:text-slate-400 text-center max-w-sm mb-4">
        {activeFilterDescription
          ? `No records match the filter "${activeFilterDescription}". Try adjusting your filters.`
          : 'No records match your current filters. Try adjusting or clearing them.'}
      </p>
      <button
        onClick={onClearFilters}
        className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium text-primary dark:text-primary bg-blue-50 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-lg hover:bg-blue-100 dark:hover:bg-primary/20 transition-colors"
      >
        <FilterX size={14} />
        Clear Filters
      </button>
    </div>
  );
}

// ── Empty Total (First Use) State ─────────────────────────────────────────────

/**
 * EmptyTotalState — shown when module has zero records total (first use).
 * Module-contextual description + create button (RBAC-gated).
 *
 * Requirements: 9.4
 */
export function EmptyTotalState({
  moduleName,
  moduleDescription,
  onCreateRecord,
  createPermission,
  className,
}: EmptyTotalStateProps): React.ReactElement {
  const canCreate = useHasPermission(createPermission);

  const defaultDescriptions: Record<string, string> = {
    leads: 'Start building your pipeline by creating your first lead. Track prospects from initial contact through qualification.',
    contacts: 'Add contacts to manage your relationships and communication history in one place.',
    accounts: 'Create accounts to organize and track your business relationships with organizations.',
    deals: 'Create your first deal to start tracking revenue opportunities through your pipeline.',
  };

  const description = moduleDescription ?? defaultDescriptions[moduleName] ?? `Get started by creating your first ${moduleName.slice(0, -1)}.`;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-20 px-4',
        className,
      )}
    >
      <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-primary/10 flex items-center justify-center mb-4">
        <Plus size={24} className="text-primary dark:text-primary" />
      </div>
      <h3 className="text-[15px] font-semibold text-[#0F172A] dark:text-white mb-1.5">
        No {moduleName} yet
      </h3>
      <p className="text-[13px] text-[#5A6B85] dark:text-slate-400 text-center max-w-md mb-5">
        {description}
      </p>
      {canCreate && (
        <button
          onClick={onCreateRecord}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors shadow-sm"
        >
          <Plus size={14} />
          Create {moduleName.charAt(0).toUpperCase() + moduleName.slice(1, -1)}
        </button>
      )}
    </div>
  );
}

// ── Error State ───────────────────────────────────────────────────────────────

/**
 * DataErrorState — error message in content area with retry button.
 * Toolbar is preserved by the parent ModuleWorkspace.
 *
 * Requirements: 9.5
 */
export function DataErrorState({
  message,
  onRetry,
  className,
}: ErrorStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4',
        className,
      )}
    >
      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
        <Loader2 size={20} className="text-red-500 dark:text-red-400" />
      </div>
      <h3 className="text-[14px] font-semibold text-[#0F172A] dark:text-white mb-1">
        Something went wrong
      </h3>
      <p className="text-[13px] text-[#5A6B85] dark:text-slate-400 text-center max-w-sm mb-4">
        {message ?? 'Failed to load data. Please try again.'}
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
      >
        <RefreshCw size={14} />
        Retry
      </button>
    </div>
  );
}

export function DataLoadingSpinner({ label = 'Loading...', hideLabel = false }: { label?: string; hideLabel?: boolean }) {
  return <div role="status" aria-label={label} className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500"><Loader2 aria-hidden="true" size={24} className="text-primary animate-spin motion-reduce:animate-none" />{!hideLabel && label}</div>;
}
