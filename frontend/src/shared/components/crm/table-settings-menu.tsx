'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Settings2, Columns3, ListOrdered, Eye, Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViewMode } from '@/shared/hooks/use-table-preferences';

// ─────────────────────────────────────────────────────
// Table Settings Menu — Records Per Page & View Mode
// Matches the reference UI: a gear-icon dropdown with
// "Manage Columns", "Reset Column Size", separator,
// "Records Per Page" (submenu: 10/20/30/40/50),
// "View Mode" (submenu: Wrap Text / Clip Text).
// ─────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 20, 25, 30, 40, 50] as const;

interface TableSettingsMenuProps {
  /** Current records per page */
  pageSize: number;
  /** Handler for page size change */
  onPageSizeChange: (size: number) => void;
  /** Current view mode */
  viewMode: ViewMode;
  /** Handler for view mode change */
  onViewModeChange: (mode: ViewMode) => void;
  /** Handler for "Manage Columns" click */
  onManageColumns: () => void;
  /** Handler for "Reset Column Size" click */
  onResetColumnSize?: () => void;
}

export function TableSettingsMenu({
  pageSize,
  onPageSizeChange,
  viewMode,
  onViewModeChange,
  onManageColumns,
  onResetColumnSize,
}: TableSettingsMenuProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'pageSize' | 'viewMode' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveSubmenu(null);
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
        setActiveSubmenu(null);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = (): void => {
    setIsOpen((prev) => !prev);
    setActiveSubmenu(null);
  };

  const handlePageSizeSelect = (size: number): void => {
    onPageSizeChange(size);
    setIsOpen(false);
    setActiveSubmenu(null);
  };

  const handleViewModeSelect = (mode: ViewMode): void => {
    onViewModeChange(mode);
    setIsOpen(false);
    setActiveSubmenu(null);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button */}
      <button
        onClick={handleToggle}
        className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        aria-label="Table settings"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Settings2 size={13} />
      </button>

      {/* Main Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5 overflow-visible">
          {/* Manage Columns */}
          <button
            onClick={() => {
              onManageColumns();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Settings2 size={14} className="text-[#5A6B85] dark:text-slate-400" />
            Manage Columns
          </button>

          {/* Reset Column Size */}
          {onResetColumnSize && (
            <button
              onClick={() => {
                onResetColumnSize();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Columns3 size={14} className="text-[#5A6B85] dark:text-slate-400" />
              Reset Column Size
            </button>
          )}

          {/* Separator */}
          <div className="my-1.5 border-t border-[#E4E9F0] dark:border-slate-700" />

          {/* Records Per Page */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSubmenu('pageSize')}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              aria-haspopup="true"
              aria-expanded={activeSubmenu === 'pageSize'}
            >
              <ListOrdered size={14} className="text-[#5A6B85] dark:text-slate-400" />
              <span className="flex-1 text-left">Records Per Page</span>
              <span className="text-[12px] font-semibold text-[#0F172A] dark:text-slate-200 mr-1">
                {pageSize}
              </span>
              <ChevronRight size={12} className="text-[#5A6B85] dark:text-slate-400" />
            </button>

            {/* Page Size Submenu */}
            {activeSubmenu === 'pageSize' && (
              <div className="absolute right-full top-0 mr-1 w-32 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    onClick={() => handlePageSizeSelect(size)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                      pageSize === size
                        ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                        : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                    )}
                  >
                    {pageSize === size && <Check size={13} className="shrink-0" />}
                    {pageSize !== size && <span className="w-[13px] shrink-0" />}
                    {size}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View Mode */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSubmenu('viewMode')}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              aria-haspopup="true"
              aria-expanded={activeSubmenu === 'viewMode'}
            >
              <Eye size={14} className="text-[#5A6B85] dark:text-slate-400" />
              <span className="flex-1 text-left">View Mode</span>
              <span className="text-[12px] font-semibold text-[#0F172A] dark:text-slate-200 mr-1">
                {viewMode === 'wrap' ? 'Wrap Text' : 'Clip Text'}
              </span>
              <ChevronRight size={12} className="text-[#5A6B85] dark:text-slate-400" />
            </button>

            {/* View Mode Submenu */}
            {activeSubmenu === 'viewMode' && (
              <div className="absolute right-full top-0 mr-1 w-36 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                <button
                  onClick={() => handleViewModeSelect('wrap')}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    viewMode === 'wrap'
                      ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                      : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                  )}
                >
                  {viewMode === 'wrap' && <Check size={13} className="shrink-0" />}
                  {viewMode !== 'wrap' && <span className="w-[13px] shrink-0" />}
                  Wrap Text
                </button>
                <button
                  onClick={() => handleViewModeSelect('clip')}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    viewMode === 'clip'
                      ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                      : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                  )}
                >
                  {viewMode === 'clip' && <Check size={13} className="shrink-0" />}
                  {viewMode !== 'clip' && <span className="w-[13px] shrink-0" />}
                  Clip Text
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
