/**
 * ColumnsPopover - Close.com-style compact column management dropdown.
 *
 * Shows a "Columns" button that opens a popover with:
 * - Search input to filter column labels
 * - Grouped column list with checkboxes
 * - Name column always locked/required
 * - Cancel / Apply buttons
 */

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Columns3, Search, Lock, X, Check } from 'lucide-react';
import type { ColumnDefinition, ColumnConfigItem } from '@leadcrm/shared';

export interface ColumnsPopoverProps {
  registry: ColumnDefinition[];
  effectiveColumns: ColumnConfigItem[];
  onApply: (columns: ColumnConfigItem[]) => void;
  onReset?: () => void;
  hiddenCount?: number;
}

export function ColumnsPopover({
  registry,
  effectiveColumns,
  onApply,
  onReset,
  hiddenCount,
}: ColumnsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<ColumnConfigItem[]>([]);

  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOpen = () => {
    const current: ColumnConfigItem[] = registry.map((col) => {
      const existing = effectiveColumns.find((ec) => ec.id === col.id);
      return existing ?? { id: col.id, visible: col.defaultVisible, order: col.defaultOrder };
    });
    setDraft(current);
    setSearch('');
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setSearch('');
  };

  const handleApply = () => {
    onApply(draft);
    setOpen(false);
  };

  const toggleColumn = (id: string) => {
    const reg = registry.find((r) => r.id === id);
    if (reg?.required) return;
    setDraft((prev) =>
      prev.map((col) =>
        col.id === id ? { ...col, visible: !col.visible } : col,
      ),
    );
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const groupedColumns = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const filtered = registry.filter(
      (col) =>
        col.label.toLowerCase().includes(lowerSearch) ||
        col.group?.toLowerCase().includes(lowerSearch),
    );

    const groupMap = new Map<string, ColumnDefinition[]>();
    for (const col of filtered) {
      const group = col.group ?? 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(col);
    }
    return Array.from(groupMap.entries()).map(([name, columns]) => ({
      name,
      columns,
    }));
  }, [registry, search]);

  const visibleCount = draft.filter((c) => c.visible).length;
  const totalCount = registry.length;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={open ? handleClose : handleOpen}
        className={[
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-medium transition-all duration-150',
          open
            ? 'bg-[#EBF0FF] border-primary text-primary dark:bg-blue-900/30 dark:border-primary dark:text-primary'
            : 'bg-white dark:bg-slate-800 border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] dark:text-slate-400 hover:border-primary hover:text-primary dark:hover:text-blue-400',
        ].join(' ')}
        aria-label="Manage columns"
        aria-expanded={open}
      >
        <Columns3 size={13} />
        <span>Columns</span>
        {hiddenCount !== undefined && hiddenCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold leading-none">
            {hiddenCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-50 w-[272px] rounded-xl shadow-lg shadow-slate-200/60 dark:shadow-slate-900/60 border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col overflow-hidden"
          role="dialog"
          aria-label="Manage columns"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="text-[12px] font-semibold text-[#0F172A] dark:text-white">
              Columns
              <span className="ml-1.5 text-[11px] font-normal text-[#8899a6]">
                {visibleCount}/{totalCount} visible
              </span>
            </span>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center rounded text-[#8899a6] hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={13} />
            </button>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8899a6] pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search columns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-7 pl-7 pr-3 text-[12px] rounded-md border border-[#E4E9F0] dark:border-slate-600 bg-[#F6F8FB] dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 placeholder:text-[#8899a6] focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                autoFocus
              />
            </div>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {groupedColumns.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-[#8899a6]">
                No columns match your search.
              </p>
            ) : (
              groupedColumns.map(({ name, columns }) => (
                <div key={name}>
                  <div className="px-3 py-1.5 sticky top-0 bg-white dark:bg-slate-800 z-10">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8899a6] dark:text-slate-500">
                      {name}
                    </span>
                  </div>
                  {columns.map((col) => {
                    const draftItem = draft.find((d) => d.id === col.id);
                    const isVisible = draftItem?.visible ?? col.defaultVisible;
                    const isRequired = col.required;

                    return (
                      <button
                        key={col.id}
                        onClick={() => toggleColumn(col.id)}
                        disabled={isRequired}
                        className={[
                          'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-100',
                          isRequired
                            ? 'cursor-default opacity-70'
                            : 'hover:bg-[#F6F8FB] dark:hover:bg-slate-700/50 cursor-pointer',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'inline-flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0',
                            isRequired
                              ? 'bg-[#E4E9F0] dark:bg-slate-600 border-[#E4E9F0] dark:border-slate-600'
                              : isVisible
                                ? 'bg-primary border-primary'
                                : 'bg-white dark:bg-slate-800 border-[#CBD5E1] dark:border-slate-600',
                          ].join(' ')}
                        >
                          {isRequired ? (
                            <Lock
                              size={8}
                              className="text-[#8899a6] dark:text-slate-400"
                            />
                          ) : isVisible ? (
                            <Check
                              size={9}
                              className="text-white"
                              strokeWidth={3}
                            />
                          ) : null}
                        </span>
                        <span className="text-[12px] text-[#3C4858] dark:text-slate-300 truncate flex-1">
                          {col.label}
                        </span>
                        {isRequired && (
                          <span className="text-[10px] text-[#8899a6] dark:text-slate-500 shrink-0">
                            Required
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 bg-[#F6F8FB] dark:bg-slate-900/50">
            {onReset && (
              <button
                onClick={() => {
                  onReset?.();
                  handleClose();
                }}
                className="text-[11px] text-[#5A6B85] dark:text-slate-400 hover:text-[#EF4444] transition-colors"
              >
                Reset defaults
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={handleClose}
                className="h-7 px-3 text-[12px] font-medium text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                className="h-7 px-3 text-[12px] font-semibold text-white bg-primary hover:bg-primary/90 rounded-md transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
