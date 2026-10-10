/**
 * DataGridQuickFilter — Fast in-memory search bar for the DataGrid.
 *
 * Renders a compact search input with optional field-level filter dropdown.
 * Designed to sit above the DataGrid and filter visible data client-side.
 *
 * @example
 * ```tsx
 * <DataGridQuickFilter
 *   value={searchTerm}
 *   onChange={setSearchTerm}
 *   placeholder="Search leads..."
 *   totalCount={filteredLeads.length}
 * />
 * ```
 */

'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DataGridQuickFilterProps {
  /** Current search value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Total matched record count (displayed as badge) */
  totalCount?: number;
  /** Additional className */
  className?: string;
}

export function DataGridQuickFilter({
  value,
  onChange,
  placeholder = 'Quick filter...',
  totalCount,
  className,
}: DataGridQuickFilterProps): React.ReactElement {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search
        size={14}
        className="absolute left-3 text-slate-400 dark:text-slate-500 pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-9 w-full max-w-[280px] pl-9 pr-8 rounded-lg border text-sm',
          'border-gray-200 dark:border-white/[0.08]',
          'bg-white dark:bg-white/[0.02]',
          'text-slate-900 dark:text-white',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20',
          'transition-colors',
        )}
        aria-label="Quick filter search"
      />

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}

      {/* Optional count badge */}
      {totalCount !== undefined && value && (
        <span className="ml-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {totalCount} {totalCount === 1 ? 'result' : 'results'}
        </span>
      )}
    </div>
  );
}
