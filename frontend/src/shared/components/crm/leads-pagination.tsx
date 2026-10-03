'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageSizeSelect } from '@/shared/components/page-size-select';
import { cn } from '@/lib/utils';

export const LEADS_PAGE_SIZES = [10, 20, 25, 50, 100];

/** The Leads footer, shared without changing the caller's data source. */
export function LeadsPagination({ currentPage, totalRecords, pageSize, onPageChange, onPageSizeChange, refreshing = false, disabled = false, loading = false }: {
  currentPage: number;
  totalRecords: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  refreshing?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  return <nav aria-label="Pagination" className="flex min-w-0 flex-wrap items-center justify-between gap-1 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3 mt-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
      <span className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">Per page</span>
      <PageSizeSelect value={pageSize} options={LEADS_PAGE_SIZES} disabled={disabled} onChange={onPageSizeChange} />
      <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 " aria-live="polite">
        {refreshing && <span className="ml-1.5 text-blue-400 dark:text-blue-500" aria-label="Refreshing data">↻</span>}
      </span>
    </div>
    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
      <span className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">Page {currentPage} of {loading ? '…' : totalPages}</span>
      {[{ label: 'Previous page', page: currentPage - 1, unavailable: currentPage <= 1, Icon: ChevronLeft },
        { label: 'Next page', page: currentPage + 1, unavailable: currentPage >= totalPages, Icon: ChevronRight }].map(({ label, page, unavailable, Icon }) =>
        <button key={label} type="button" onClick={() => onPageChange(page)} disabled={disabled || unavailable} aria-label={label}
          className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
            disabled || unavailable ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')}>
          <Icon size={14} aria-hidden="true" />
        </button>)}
    </div>
  </nav>;
}
