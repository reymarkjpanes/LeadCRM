'use client';

import React, { useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPageNumbers } from '@/shared/utils/pagination';
import type { PaginationProps } from '@/shared/types/pagination';

// ─── Page Button ───────────────────────────────────────────────────────────────

function PageButton({
  page,
  isCurrent,
  onClick,
  disabled,
}: {
  page: number;
  isCurrent: boolean;
  onClick: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(page)}
      disabled={disabled}
      aria-label={`Page ${page}`}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'inline-flex items-center justify-center min-w-[32px] h-8 px-2 text-xs font-medium rounded-md transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        isCurrent
          ? 'bg-primary text-white shadow-sm'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {page}
    </button>
  );
}

// ─── Nav Button (arrows) ──────────────────────────────────────────────────────

function NavButton({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 transition-all duration-150',
        'hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-700 dark:hover:text-slate-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        'disabled:opacity-30 disabled:pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

// ─── Ellipsis ─────────────────────────────────────────────────────────────────

function Ellipsis() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center w-8 h-8 text-slate-400 dark:text-slate-500 text-xs select-none"
    >
      …
    </span>
  );
}

// ─── Main Pagination Component ────────────────────────────────────────────────

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  pageSizeOptions = [10, 20, 25, 30, 40, 50],
  onPageChange,
  onPageSizeChange,
  isLoading = false,
  className,
}: PaginationProps) {
  const pages = getPageNumbers(currentPage, totalPages, 1);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Range text
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const rangeText =
    totalItems === 0
      ? 'No results'
      : `Showing ${start}–${end} of ${totalItems}`;

  // Keyboard handler on the page-number group
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPageChange(currentPage - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onPageChange(currentPage + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onPageChange(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        onPageChange(totalPages);
      }
    },
    [currentPage, totalPages, hasPrev, hasNext, onPageChange],
  );

  // Don't render anything when there's truly nothing to paginate
  if (isLoading || totalItems === 0) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 pb-1 px-1',
        className,
      )}
    >
      {/* ── Left: range + page-size selector ──────────────────────────────── */}
      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        {isLoading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </span>
        ) : (
          <span>{rangeText}</span>
        )}

        <span className="hidden sm:inline text-slate-300 dark:text-white/10">|</span>

        <label className="hidden sm:flex items-center gap-1.5">
          <span className="text-slate-400 dark:text-slate-500">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className={cn(
              'h-7 pl-2 pr-6 rounded-md border text-xs font-medium appearance-none cursor-pointer',
              'border-slate-200 dark:border-white/[0.1]',
              'bg-white dark:bg-slate-900',
              'text-slate-700 dark:text-slate-300',
              'hover:border-slate-300 dark:hover:border-white/[0.15]',
              'focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:outline-none',
              'transition-colors',
            )}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Right: page navigation ────────────────────────────────────────── */}
      <div
        className="flex items-center gap-0.5"
        role="group"
        aria-label="Page navigation"
        onKeyDown={handleKeyDown}
      >
        {/* First */}
        <NavButton
          onClick={() => onPageChange(1)}
          disabled={!hasPrev || isLoading}
          ariaLabel="First page"
        >
          <ChevronsLeft className="w-4 h-4" />
        </NavButton>

        {/* Previous */}
        <NavButton
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrev || isLoading}
          ariaLabel="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </NavButton>

        {/* Page numbers */}
        <div className="hidden sm:flex items-center gap-0.5 mx-1">
          {pages.map((page, idx) =>
            page === null ? (
              <Ellipsis key={`ellipsis-${idx}`} />
            ) : (
              <PageButton
                key={page}
                page={page}
                isCurrent={page === currentPage}
                onClick={onPageChange}
                disabled={isLoading}
              />
            ),
          )}
        </div>

        {/* Mobile page indicator */}
        <span className="sm:hidden text-xs font-medium text-slate-600 dark:text-slate-400 mx-2">
          {currentPage} / {totalPages}
        </span>

        {/* Next */}
        <NavButton
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNext || isLoading}
          ariaLabel="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </NavButton>

        {/* Last */}
        <NavButton
          onClick={() => onPageChange(totalPages)}
          disabled={!hasNext || isLoading}
          ariaLabel="Last page"
        >
          <ChevronsRight className="w-4 h-4" />
        </NavButton>
      </div>
    </nav>
  );
}
