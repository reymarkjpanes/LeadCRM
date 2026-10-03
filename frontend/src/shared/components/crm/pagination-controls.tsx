'use client';

import React, { useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export const PAGE_SIZE_OPTIONS = [10, 20, 25, 30, 40, 50] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export interface PaginationControlsProps {
  /** Current page (1-based) */
  currentPage: number;
  /** Total number of records */
  totalRecords: number;
  /** Current page size */
  pageSize: number;
  /** Page change handler */
  onPageChange: (page: number) => void;
  /** Page size change handler — resets to page 1 and persists */
  onPageSizeChange: (size: number) => void;
  /** Optional className for container */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * PaginationControls — consistent footer pagination across all CRM modules.
 *
 * Displays:
 * - Current page range ("1 to 25" or "26 to 30")
 * - Previous/Next navigation buttons
 * - Page indicator ("1 / 4")
 *
 * Behavior:
 * - Disables prev on page 1
 * - Disables next on last page
 * - Zero records: shows "0 to 0", hides nav buttons
 * - Page size change: resets to page 1
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7
 */
export function PaginationControls({
  currentPage,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className,
}: PaginationControlsProps): React.ReactElement {
  const totalPages = useMemo(
    () => (totalRecords > 0 ? Math.ceil(totalRecords / pageSize) : 0),
    [totalRecords, pageSize],
  );

  const rangeStart = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = totalRecords === 0 ? 0 : Math.min(currentPage * pageSize, totalRecords);

  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;
  const hasRecords = totalRecords > 0;

  const handlePrev = useCallback(() => {
    if (!isFirstPage) {
      onPageChange(currentPage - 1);
    }
  }, [currentPage, isFirstPage, onPageChange]);

  const handleNext = useCallback(() => {
    if (!isLastPage) {
      onPageChange(currentPage + 1);
    }
  }, [currentPage, isLastPage, onPageChange]);

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSize = Number(e.target.value);
      onPageSizeChange(newSize);
    },
    [onPageSizeChange],
  );

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-1 px-2 py-2 sm:px-4 sm:py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800/60 rounded-b-xl',
        className,
      )}
      role="navigation"
      aria-label="Pagination"
    >
      {/* Left: Total records + page range */}
      <div className="hidden sm:flex items-center gap-3">
        <span className="text-[10px] sm:text-[12px] text-[#5A6B85] dark:text-slate-400">
          <span className="tabular-nums">
            {rangeStart} to {rangeEnd}
          </span>
        </span>
      </div>

      {/* Center: Page size selector */}
      <div className="flex items-center gap-1 sm:gap-2">
        <label
          htmlFor="page-size-select"
          className="whitespace-nowrap text-[10px] sm:text-[11.5px] text-[#5A6B85] dark:text-slate-400"
        >
          Per page
        </label>
        <select
          id="page-size-select"
          value={pageSize}
          onChange={handlePageSizeChange}
          className="h-7 px-2 text-[10px] sm:text-[12px] font-medium rounded-md border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 cursor-pointer"
          aria-label="Records per page"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {/* Right: Navigation */}
      <div className="flex items-center gap-1 sm:gap-2">
        {hasRecords && (
          <>
            <span className="text-[10px] sm:text-[12px] text-[#5A6B85] dark:text-slate-400 tabular-nums">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={handlePrev}
              disabled={isFirstPage}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                isFirstPage
                  ? 'border-[#E4E9F0] dark:border-slate-700 text-[#C5CDD8] dark:text-slate-600 cursor-not-allowed'
                  : 'border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-[#0F172A] dark:hover:text-white',
              )}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={handleNext}
              disabled={isLastPage}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                isLastPage
                  ? 'border-[#E4E9F0] dark:border-slate-700 text-[#C5CDD8] dark:text-slate-600 cursor-not-allowed'
                  : 'border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-[#0F172A] dark:hover:text-white',
              )}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
