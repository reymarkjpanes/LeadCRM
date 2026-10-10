'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortPreference } from '@/shared/hooks/use-table-preferences';
import type { ColumnDefinition } from '@leadcrm/shared';

// ─────────────────────────────────────────────────────
// Sort Dropdown — fully functional sort with field + direction
// Shows sortable columns from the registry, current active sort,
// and allows clearing.
// ─────────────────────────────────────────────────────

interface SortDropdownProps {
  /** Current sort preference */
  sort: SortPreference | null;
  /** Handler for sort change */
  onSortChange: (sort: SortPreference | null) => void;
  /** Column registry to pull sortable fields from */
  registry: ColumnDefinition[];
}

export function SortDropdown({
  sort,
  onSortChange,
  registry,
}: SortDropdownProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleFieldClick = (fieldId: string): void => {
    if (sort?.field === fieldId) {
      // Toggle direction
      const newDirection = sort.direction === 'asc' ? 'desc' : 'asc';
      onSortChange({ field: fieldId, direction: newDirection });
    } else {
      // Set new sort field with default asc
      onSortChange({ field: fieldId, direction: 'asc' });
    }
    setIsOpen(false);
  };

  const handleClearSort = (): void => {
    onSortChange(null);
    setIsOpen(false);
  };

  const activeLabel = sort
    ? registry.find((col) => col.id === sort.field)?.label ?? sort.field
    : null;

  return (
    <div className="relative" ref={menuRef}>
      {/* Sort trigger button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-lg border transition-colors',
          sort
            ? 'bg-primary/10 text-primary dark:text-primary border-primary/30 hover:bg-primary/20'
            : 'text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border-[#E4E9F0] dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
        )}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Sort"
      >
        <ArrowUpDown size={13} />
        Sort
        {sort && (
          <>
            <span className="text-[11px] opacity-80">
              ({activeLabel} {sort.direction === 'asc' ? '↑' : '↓'})
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClearSort();
              }}
              className="ml-0.5 p-0.5 rounded hover:bg-primary/20 transition-colors"
              aria-label="Clear sort"
            >
              <X size={11} />
            </button>
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-52 max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
          {/* Clear sort option */}
          {sort && (
            <>
              <button
                onClick={handleClearSort}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              >
                <X size={13} />
                Clear Sort
              </button>
              <div className="my-1 border-t border-[#E4E9F0] dark:border-slate-700" />
            </>
          )}

          {/* Sortable fields */}
          {registry.map((col) => {
            const isActive = sort?.field === col.id;
            const direction = isActive ? sort!.direction : null;

            return (
              <button
                key={col.id}
                onClick={() => handleFieldClick(col.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                    : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                )}
              >
                <span className="flex-1 text-left truncate">{col.label}</span>
                {isActive && direction === 'asc' && <ArrowUp size={13} />}
                {isActive && direction === 'desc' && <ArrowDown size={13} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
