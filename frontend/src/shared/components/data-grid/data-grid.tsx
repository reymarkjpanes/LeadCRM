/**
 * DataGrid — A modern, reusable data-grid component for LeadCRM.
 *
 * Features:
 * - Sticky header (pinned during vertical scroll)
 * - Pinned left columns (checkbox + primary identifier stay visible during horizontal scroll)
 * - Resizable columns (drag handles on header cell right edge)
 * - Per-column sorting (header click cycles asc → desc → none; icon shows current state)
 * - Bulk selection (select-all checkbox + row checkboxes)
 * - Quick-action icons (inline on hover, no row selection trigger)
 * - Summary/calculation sticky footer
 * - Two-axis scrolling with uniform spacing and truncation
 * - Dark mode support
 * - Full accessibility (ARIA grid pattern, keyboard navigation)
 *
 * Architecture:
 * - Filtering/sorting state is abstract — passed in via props, not owned internally.
 *   This enables the parent to toggle between Table/List/Kanban views while
 *   retaining filter/sort state.
 * - Cell rendering is fully customizable via `cell` render functions on column defs.
 * - Column widths can be controlled externally for persistence.
 *
 * @example
 * ```tsx
 * <DataGrid
 *   columns={columnDefs}
 *   data={paginatedLeads}
 *   getRowId={(row) => row.id}
 *   height={600}
 *   selectable
 *   sort={sort}
 *   onSortChange={setSort}
 *   onRowClick={(row) => setSelectedLead(row)}
 *   quickActions={[
 *     { id: 'call', label: 'Call', icon: <Phone size={14} />, onClick: handleCall },
 *     { id: 'email', label: 'Email', icon: <Mail size={14} />, onClick: handleEmail },
 *   ]}
 *   summaryLabel={`${totalCount} records`}
 * />
 * ```
 */

'use client';

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Settings2, SearchX, Inbox, Plus, EyeOff } from 'lucide-react';
import { useColumnResize } from './use-column-resize';
import { useDataGridSort } from './use-data-grid-sort';
import { useBulkSelection } from './use-bulk-selection';
import { ColumnHeaderMenu } from './column-header-menu';
import { RowActionsMenu } from './row-actions-menu';
import { TruncatedCellTooltip } from './truncated-cell-tooltip';
import { useGridKeyboardNav } from './use-grid-keyboard-nav';
import type {
  DataGridProps,
  DataGridColumnDef,
  CellRenderContext,
  SortDirection,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_COLUMN_WIDTH = 180;
const DEFAULT_MIN_WIDTH = 100;
const CHECKBOX_COLUMN_WIDTH = 44;
const ROW_ACTIONS_WIDTH = 40;
const ACTIONS_COLUMN_WIDTH = 100;
const SETTINGS_COLUMN_WIDTH = 36;
const HIDDEN_BADGE_COLUMN_WIDTH = 80;
const ROW_HEIGHT_NORMAL = 44;
const ROW_HEIGHT_DENSE = 36;
const HEADER_HEIGHT = 40;

// ─── Resize Handle ───────────────────────────────────────────────────────────

interface ResizeHandleProps {
  columnId: string;
  currentWidth: number;
  onStartResize: (columnId: string, startX: number, currentWidth: number) => void;
  isResizing: boolean;
}

function ResizeHandle({ columnId, currentWidth, onStartResize, isResizing }: ResizeHandleProps): React.ReactElement {
  return (
    <div
      className={cn(
        'absolute right-0 top-0 h-full w-[5px] cursor-col-resize z-10',
        'group-hover/header:bg-blue-400/30',
        isResizing && 'bg-blue-500/50',
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onStartResize(columnId, e.clientX, currentWidth);
      }}
      aria-hidden="true"
    />
  );
}

// ─── Memoized Row Component ──────────────────────────────────────────────────
// Extracted as React.memo to avoid re-rendering all rows when a single
// selection toggle occurs. With Set-based selection, only the toggled row's
// `isSelected` prop changes, so other rows skip re-render.

interface DataGridRowProps<T> {
  row: T;
  rowId: string;
  rowIdx: number;
  selected: boolean;
  selectable: boolean;
  pinnedLeftColumns: DataGridColumnDef<T>[];
  scrollableColumns: DataGridColumnDef<T>[];
  pinnedRightColumns: DataGridColumnDef<T>[];
  pinnedLeftOffsets: Record<string, number>;
  isScrolled: boolean;
  viewMode: 'wrap' | 'clip';
  rowHeight: number;
  cellContentClass: string;
  hasQuickActions: boolean;
  quickActions?: Array<{ id: string; label: string; icon: React.ReactNode; onClick: (row: T) => void; visible?: (row: T) => boolean }>;
  showToolbarColumn: boolean;
  rowActions?: (row: T) => Array<{ id: string; label: string; icon?: React.ReactNode; onClick: () => void; variant?: string; disabled?: boolean }>;
  hasRowActions: boolean;
  onRowClick?: (row: T) => void;
  toggleRow: (id: string) => void;
  renderCellContent: (col: DataGridColumnDef<T>, row: T, rowIdx: number) => React.ReactNode;
}

function DataGridRowInner<T>({
  row,
  rowId,
  rowIdx,
  selected,
  selectable,
  pinnedLeftColumns,
  scrollableColumns,
  pinnedRightColumns,
  pinnedLeftOffsets,
  isScrolled,
  viewMode,
  rowHeight,
  cellContentClass,
  hasQuickActions,
  quickActions,
  showToolbarColumn,
  rowActions,
  hasRowActions,
  onRowClick,
  toggleRow,
  renderCellContent,
}: DataGridRowProps<T>): React.ReactElement {
  return (
    <tr
      className={cn(
        'transition-colors duration-100 cursor-pointer group/row border-b border-[#eef0f3] dark:border-slate-800',
        selected
          ? 'bg-blue-50 dark:bg-blue-500/10'
          : 'hover:bg-[#f7f8fa] dark:hover:bg-slate-800/50',
      )}
      style={viewMode === 'wrap' ? { minHeight: rowHeight, maxHeight: 156 } : { height: rowHeight }}
      onClick={() => onRowClick?.(row)}
      aria-selected={selected}
      role="row"
    >
      {/* Row actions menu (⋯) — leftmost cell */}
      {hasRowActions && rowActions && (
        <td
          className={cn(
            'sticky left-0 z-10 px-1 text-center border-r border-[#eef0f3] dark:border-slate-800',
            selected
              ? 'bg-blue-50/60 dark:bg-blue-500/5'
              : 'bg-white dark:bg-slate-900 group-hover/row:bg-[#f7f8fa] dark:group-hover/row:bg-slate-800/50',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <RowActionsMenu actions={rowActions(row)} position="left" />
          </div>
        </td>
      )}

      {/* Checkbox cell — pinned left */}
      {selectable && (
        <td
          className={cn(
            'sticky z-10 px-3 text-center border-r border-[#eef0f3] dark:border-slate-800',
            selected
              ? 'bg-blue-50/60 dark:bg-blue-500/5'
              : 'bg-white dark:bg-slate-900 group-hover/row:bg-[#f7f8fa] dark:group-hover/row:bg-slate-800/50',
            pinnedLeftColumns.length === 0 && isScrolled
              ? 'shadow-[4px_0_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.25)]'
              : 'shadow-[inset_-1px_0_0_0_#eef0f3] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06)]',
          )}
          style={{ left: hasRowActions ? ROW_ACTIONS_WIDTH : 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleRow(rowId)}
            className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer accent-[#2563EB]"
            aria-label={`Select record ${rowId}`}
          />
        </td>
      )}

      {/* Pinned left data cells */}
      {pinnedLeftColumns.map((col, colIdx) => {
        const cellContent = renderCellContent(col, row, rowIdx);
        const shouldShowTooltip = viewMode === 'clip' && !col.cell;
        const cellText = shouldShowTooltip ? String(cellContent ?? '') : '';
        const isLastPinned = colIdx === pinnedLeftColumns.length - 1;

        return (
          <td
            key={col.id}
            className={cn(
              'sticky z-10 px-3 border-r border-[#eef0f3] dark:border-slate-800',
              selected
                ? 'bg-blue-50/60 dark:bg-blue-500/5'
                : 'bg-white dark:bg-slate-900 group-hover/row:bg-[#f7f8fa] dark:group-hover/row:bg-slate-800/50',
              isLastPinned && isScrolled
                ? 'shadow-[4px_0_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.25)]'
                : 'shadow-[inset_-1px_0_0_0_#eef0f3] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06)]',
              col.align === 'right' && 'text-right',
              col.align === 'center' && 'text-center',
              'text-[13px] text-[#0F172A] dark:text-slate-200',
              viewMode === 'wrap' && 'py-2',
            )}
            style={{ left: pinnedLeftOffsets[col.id] }}
          >
            {shouldShowTooltip ? (
              <TruncatedCellTooltip
                content={cellText}
                className={cn('flex items-center h-full truncate', cellContentClass)}
              >
                {cellContent}
              </TruncatedCellTooltip>
            ) : (
              <div className={cn('flex items-center', viewMode === 'clip' ? 'h-full truncate' : 'min-h-[28px]', cellContentClass)}>
                {cellContent}
              </div>
            )}
          </td>
        );
      })}

      {/* Scrollable data cells */}
      {scrollableColumns.map((col) => {
        const cellContent = renderCellContent(col, row, rowIdx);
        const shouldShowTooltip = viewMode === 'clip' && !col.cell;
        const cellText = shouldShowTooltip ? String(cellContent ?? '') : '';

        return (
          <td
            key={col.id}
            className={cn(
              'px-3 border-r border-[#eef0f3] dark:border-slate-800',
              col.align === 'right' && 'text-right',
              col.align === 'center' && 'text-center',
              'text-[13px] text-[#0F172A] dark:text-slate-200',
              viewMode === 'wrap' && 'py-2',
            )}
          >
            {shouldShowTooltip ? (
              <TruncatedCellTooltip
                content={cellText}
                className={cn('flex items-center h-full truncate', cellContentClass)}
              >
                {cellContent}
              </TruncatedCellTooltip>
            ) : (
              <div className={cn('flex items-center', viewMode === 'clip' ? 'h-full truncate' : 'min-h-[28px]', cellContentClass)}>
                {cellContent}
              </div>
            )}
          </td>
        );
      })}

      {/* Pinned right data cells */}
      {pinnedRightColumns.map((col) => {
        const cellContent = renderCellContent(col, row, rowIdx);
        const shouldShowTooltip = viewMode === 'clip' && !col.cell;
        const cellText = shouldShowTooltip ? String(cellContent ?? '') : '';

        return (
          <td
            key={col.id}
            className={cn(
              'sticky right-0 z-10 px-3',
              selected
                ? 'bg-blue-50/60 dark:bg-blue-500/5'
                : 'bg-white dark:bg-slate-900 group-hover/row:bg-[#f7f8fa] dark:group-hover/row:bg-slate-800/50',
              'shadow-[inset_1px_0_0_0_#e5e7eb] dark:shadow-[inset_1px_0_0_0_rgba(255,255,255,0.06)]',
              col.align === 'right' && 'text-right',
              col.align === 'center' && 'text-center',
              'text-[13px] text-[#0F172A] dark:text-slate-200',
              viewMode === 'wrap' && 'py-2',
            )}
          >
            {shouldShowTooltip ? (
              <TruncatedCellTooltip
                content={cellText}
                className={cn('flex items-center h-full truncate', cellContentClass)}
              >
                {cellContent}
              </TruncatedCellTooltip>
            ) : (
              <div className={cn('flex items-center', viewMode === 'clip' ? 'h-full truncate' : 'min-h-[28px]', cellContentClass)}>
                {cellContent}
              </div>
            )}
          </td>
        );
      })}

      {/* Quick actions cell */}
      {hasQuickActions && quickActions && (
        <td
          className="px-2 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-1">
            {quickActions.map((action) => {
              if (action.visible && !action.visible(row)) return null;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => action.onClick(row)}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    'text-slate-400 dark:text-slate-500',
                    'hover:text-slate-700 dark:hover:text-slate-200',
                    'hover:bg-slate-100 dark:hover:bg-slate-700',
                  )}
                  title={action.label}
                  aria-label={action.label}
                >
                  {action.icon}
                </button>
              );
            })}
          </div>
        </td>
      )}

      {/* Settings/toolbar column spacer cell */}
      {showToolbarColumn && (
        <td aria-hidden="true" />
      )}
    </tr>
  );
}

// Use React.memo with generic type support via type assertion
const DataGridRow = React.memo(DataGridRowInner) as typeof DataGridRowInner;

// ─── Sort Indicator ──────────────────────────────────────────────────────────

interface SortIndicatorProps {
  direction: SortDirection | null;
  /** When true and direction is null, shows the neutral two-arrow icon */
  sortable?: boolean;
}

/**
 * Two-arrow sort indicator — down arrow (↓) and up arrow (↑) side by side.
 * Inactive:   both arrows shown in muted color
 * Ascending:  up arrow highlighted blue, down arrow muted
 * Descending: down arrow highlighted blue, up arrow muted
 */
function SortIndicator({ direction, sortable }: SortIndicatorProps): React.ReactElement | null {
  if (!sortable && !direction) return null;

  const isInactive = !direction;
  const downActive = direction === 'desc';
  const upActive   = direction === 'asc';

  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-[1px]" aria-hidden="true">
      {/* Down arrow ↓ */}
      <svg width="6" height="8" viewBox="0 0 6 8" fill="none" xmlns="http://www.w3.org/2000/svg"
        className={downActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'}
      >
        <path d="M3 7L0.5 2.5H5.5L3 7Z" fill="currentColor" />
        <line x1="3" y1="0.5" x2="3" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      {/* Up arrow ↑ */}
      <svg width="6" height="8" viewBox="0 0 6 8" fill="none" xmlns="http://www.w3.org/2000/svg"
        className={upActive ? 'text-blue-600 dark:text-blue-400' : isInactive ? 'text-slate-300 dark:text-slate-600' : 'text-slate-300 dark:text-slate-600'}
      >
        <path d="M3 1L5.5 5.5H0.5L3 1Z" fill="currentColor" />
        <line x1="3" y1="7.5" x2="3" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// ─── DataGrid Component ──────────────────────────────────────────────────────

export function DataGrid<T = Record<string, unknown>>({
  columns,
  data,
  getRowId,
  height = 'auto',
  dense = false,
  isLoading = false,
  emptyMessage = 'No records found.',
  sort = null,
  onSortChange,
  selectable = false,
  selectedIds: externalSelectedIds,
  onSelectionChange,
  onRowClick,
  quickActions,
  summaryColumns,
  summaryLabel,
  columnWidths: externalColumnWidths,
  onColumnResize,
  onColumnWidthChange,
  cellContext,
  ariaLabel = 'Data grid',
  enableColumnMenu = false,
  onPinColumn,
  onFilterByColumn,
  onHideColumn,
  rowActions,
  onSettingsClick,
  viewMode = 'clip',
  emptyState,
  hiddenColumnsCount,
}: DataGridProps<T>): React.ReactElement {
  // ─── Internal column widths state (when uncontrolled) ──────────────────
  const [internalWidths, setInternalWidths] = useState<Record<string, number>>({});
  const columnWidths = externalColumnWidths ?? internalWidths;

  const handleColumnResize = useCallback(
    (columnId: string, width: number) => {
      if (onColumnResize) {
        onColumnResize(columnId, width);
      } else {
        setInternalWidths((prev) => ({ ...prev, [columnId]: width }));
      }
    },
    [onColumnResize],
  );

  // ─── Resize hook ───────────────────────────────────────────────────────
  const { isResizing, resizingColumnId, startResize } = useColumnResize({
    onResize: handleColumnResize,
    onResizeEnd: onColumnWidthChange,
    minWidth: 80,
    maxWidth: 800,
  });

  // ─── Sort hook ─────────────────────────────────────────────────────────
  const { sortedData, handleHeaderClick, getSortDirection } = useDataGridSort({
    sort,
    onSortChange: onSortChange ?? (() => {}),
    columns,
    data,
  });

  // ─── Selection hook ────────────────────────────────────────────────────
  const {
    selectedIds,
    allSelected,
    someSelected,
    toggleRow,
    toggleAll,
    isSelected,
  } = useBulkSelection({
    data: sortedData,
    getRowId,
    selectedIds: externalSelectedIds,
    onSelectionChange,
  });

  // ─── Computed column layout ────────────────────────────────────────────
  const pinnedLeftColumns = useMemo(
    () => columns.filter((col) => col.pinned === 'left'),
    [columns],
  );
  const pinnedRightColumns = useMemo(
    () => columns.filter((col) => col.pinned === 'right'),
    [columns],
  );
  const scrollableColumns = useMemo(
    () => columns.filter((col) => !col.pinned),
    [columns],
  );

  const getColumnWidth = useCallback(
    (col: DataGridColumnDef<T>): number => {
      return columnWidths[col.id] ?? col.width ?? DEFAULT_COLUMN_WIDTH;
    },
    [columnWidths],
  );

  // Pinned left offset calculation
  const pinnedLeftOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let currentOffset = selectable ? CHECKBOX_COLUMN_WIDTH : 0;
    for (const col of pinnedLeftColumns) {
      offsets[col.id] = currentOffset;
      currentOffset += getColumnWidth(col);
    }
    return offsets;
  }, [pinnedLeftColumns, getColumnWidth, selectable]);

  // Total pinned left width (for shadow boundary)
  const totalPinnedLeftWidth = useMemo(() => {
    const base = selectable ? CHECKBOX_COLUMN_WIDTH : 0;
    return base + pinnedLeftColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);
  }, [pinnedLeftColumns, getColumnWidth, selectable]);

  // ─── Container height ──────────────────────────────────────────────────
  const containerStyle = useMemo(() => {
    if (height === 'auto') return {};
    if (typeof height === 'number') return { height: `${height}px` };
    return { height };
  }, [height]);

  const rowHeight = dense ? ROW_HEIGHT_DENSE : ROW_HEIGHT_NORMAL;

  // View mode cell content classes
  // clip: single-line with text-overflow: ellipsis
  // wrap: multi-line with line-clamp-3 (max ~3 lines, 156px row max)
  const cellContentClass = viewMode === 'wrap'
    ? 'whitespace-normal break-words line-clamp-3 overflow-hidden'
    : 'truncate';

  // Ref for scroll container
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Horizontal scroll state (for pinned column shadow) ────────────
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      setIsScrolled(el.scrollLeft > 0);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    // Check initial scroll position
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // ─── Render Helpers ────────────────────────────────────────────────────

  const renderCellContent = useCallback(
    (col: DataGridColumnDef<T>, row: T, rowIdx: number): React.ReactNode => {
      const value = col.accessor(row);
      const context: CellRenderContext = {
        helpers: cellContext,
        isSelected: isSelected(getRowId(row)),
        rowIndex: rowIdx,
      };

      if (col.cell) {
        return col.cell(value, row, context);
      }

      // Default rendering: em-dash for null/undefined/empty values
      if (value === null || value === undefined || value === '') {
        return <span className="text-[#5A6B85] dark:text-slate-400">—</span>;
      }
      return String(value);
    },
    [cellContext, isSelected, getRowId],
  );

  const hasQuickActions = quickActions && quickActions.length > 0;

  // ─── Computed toolbar column width (settings + hidden badge) ────────────
  const hasHiddenBadge = hiddenColumnsCount != null && hiddenColumnsCount > 0;
  const showToolbarColumn = onSettingsClick || hasHiddenBadge;
  const toolbarColumnWidth = hasHiddenBadge ? HIDDEN_BADGE_COLUMN_WIDTH : SETTINGS_COLUMN_WIDTH;

  // ─── ARIA Grid Keyboard Navigation ────────────────────────────────────
  const totalColCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0) + (hasQuickActions ? 1 : 0) + (showToolbarColumn ? 1 : 0);
  const {
    gridRef,
    handleGridKeyDown,
    handleCellFocus,
  } = useGridKeyboardNav({
    rowCount: sortedData.length,
    colCount: totalColCount,
    enabled: true,
  });

  // ─── ARIA Live Announcements ───────────────────────────────────────────
  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const prevSelectedCountRef = useRef(selectedIds.size);
  const prevSortRef = useRef(sort);

  // Announce selection changes
  useEffect(() => {
    const currentCount = selectedIds.size;
    const prevCount = prevSelectedCountRef.current;
    if (currentCount !== prevCount) {
      if (currentCount === 0) {
        setAriaAnnouncement('Selection cleared');
      } else {
        setAriaAnnouncement(`${currentCount} row${currentCount === 1 ? '' : 's'} selected`);
      }
      prevSelectedCountRef.current = currentCount;
    }
  }, [selectedIds]);

  // Announce sort changes
  useEffect(() => {
    const prevSort = prevSortRef.current;
    if (sort && (sort.field !== prevSort?.field || sort.direction !== prevSort?.direction)) {
      const direction = sort.direction === 'asc' ? 'ascending' : 'descending';
      setAriaAnnouncement(`Sorted by ${sort.field}, ${direction}`);
    } else if (!sort && prevSort) {
      setAriaAnnouncement('Sort cleared');
    }
    prevSortRef.current = sort;
  }, [sort]);

  // ─── Loading skeleton ──────────────────────────────────────────────────
  // Renders a placeholder skeleton that matches the column layout
  // while the table data is loading. Does NOT block toolbar/filter rail
  // rendering since those live outside this component in the parent.
  if (isLoading) {
    // Determine skeleton column count from actual columns (capped at 6 for visual balance)
    const skeletonColCount = Math.min(columns.length, 6);

    return (
      <div
        className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl overflow-hidden"
        style={containerStyle}
        role="status"
        aria-label="Loading data"
      >
        {/* Skeleton header row — 44px height */}
        <div
          className="flex items-center bg-[#F6F8FB] dark:bg-slate-800/60 border-b border-[#E4E9F0] dark:border-slate-700 px-3 gap-3"
          style={{ height: `${HEADER_HEIGHT}px` }}
        >
          {/* Checkbox placeholder */}
          {selectable && (
            <div className="w-3.5 h-3.5 bg-slate-200/70 dark:bg-slate-700/70 rounded animate-pulse shrink-0" />
          )}
          {/* Column header placeholders */}
          {Array.from({ length: skeletonColCount }).map((_, i) => (
            <div
              key={i}
              className="h-2.5 bg-slate-200/70 dark:bg-slate-700/70 rounded animate-pulse"
              style={{ width: i === 0 ? '140px' : i === 1 ? '100px' : '80px', flexShrink: 0 }}
            />
          ))}
        </div>

        {/* Skeleton body rows — at least 5 rows matching row height */}
        {Array.from({ length: 5 }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-center border-b border-[#E4E9F0] dark:border-slate-700 px-3 gap-3"
            style={{ height: `${rowHeight}px` }}
          >
            {/* Checkbox placeholder */}
            {selectable && (
              <div className="w-3.5 h-3.5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse shrink-0" />
            )}
            {/* Primary column — avatar + text block */}
            <div className="flex items-center gap-2.5 shrink-0" style={{ width: '200px' }}>
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse shrink-0" />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-[70%]" />
                <div className="h-2 bg-slate-100 dark:bg-slate-700/60 rounded animate-pulse w-[50%]" />
              </div>
            </div>
            {/* Remaining column placeholders */}
            {Array.from({ length: Math.max(skeletonColCount - 1, 2) }).map((_, colIdx) => (
              <div
                key={colIdx}
                className="h-3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse flex-1"
                style={{
                  maxWidth: colIdx === 0 ? '150px' : colIdx === 1 ? '100px' : '120px',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div
      className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl overflow-hidden flex flex-col"
      style={containerStyle}
      role="region"
      aria-label={ariaLabel}
    >
      {/* Scroll container — two-axis overflow */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        style={isResizing ? { cursor: 'col-resize' } : undefined}
      >
        <table
          className="border-collapse table-fixed"
          style={{ minWidth: '100%', width: 'max-content' }}
          role="grid"
          ref={gridRef}
          onKeyDown={handleGridKeyDown}
          aria-rowcount={sortedData.length + 1}
          aria-colcount={columns.length + (selectable ? 1 : 0)}
        >
          {/* ─── Column Group (widths) ─────────────────────────────── */}
          <colgroup>
            {rowActions && <col style={{ width: ROW_ACTIONS_WIDTH }} />}
            {selectable && <col style={{ width: CHECKBOX_COLUMN_WIDTH }} />}
            {pinnedLeftColumns.map((col) => (
              <col key={col.id} style={{ width: getColumnWidth(col), minWidth: col.minWidth ?? DEFAULT_MIN_WIDTH }} />
            ))}
            {scrollableColumns.map((col) => (
              <col key={col.id} style={{ width: getColumnWidth(col), minWidth: col.minWidth ?? DEFAULT_MIN_WIDTH }} />
            ))}
            {pinnedRightColumns.map((col) => (
              <col key={col.id} style={{ width: getColumnWidth(col), minWidth: col.minWidth ?? DEFAULT_MIN_WIDTH }} />
            ))}
            {hasQuickActions && <col style={{ width: ACTIONS_COLUMN_WIDTH }} />}
            {showToolbarColumn && <col style={{ width: toolbarColumnWidth }} />}
          </colgroup>

          {/* ─── Header ────────────────────────────────────────────── */}
          <thead className="sticky top-0 z-20">
            <tr
              role="row"
              className={cn(
                'bg-white dark:bg-slate-900',
                'border-b border-[#eef0f3] dark:border-slate-700/80',
              )}
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Row actions header spacer */}
              {rowActions && (
                <th
                  scope="col"
                  className="sticky left-0 z-30 bg-white dark:bg-slate-900"
                />
              )}

              {/* Checkbox header — pinned left */}
              {selectable && (
                <th
                  scope="col"
                  className={cn(
                    'sticky z-30 bg-white dark:bg-slate-900 border-r border-[#eef0f3] dark:border-slate-800',
                    'px-3 text-center',
                    // If no pinned left columns, checkbox is the last pinned element
                    pinnedLeftColumns.length === 0 && isScrolled
                      ? 'shadow-[4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.25)]'
                      : 'shadow-[inset_-1px_0_0_0_#eef0f3] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06)]',
                  )}
                  style={{ left: rowActions ? ROW_ACTIONS_WIDTH : 0 }}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer accent-[#2563EB]"
                    aria-label="Select all records"
                  />
                </th>
              )}

              {/* Pinned left header cells */}
              {pinnedLeftColumns.map((col, colIdx) => {
                const isLastPinned = colIdx === pinnedLeftColumns.length - 1;
                const sortDir = getSortDirection(col.id);
                const sortLabel = col.sortable
                  ? sortDir === 'asc'
                    ? `Sort by ${col.header} descending`
                    : sortDir === 'desc'
                    ? `Clear sort on ${col.header}`
                    : `Sort by ${col.header} ascending`
                  : undefined;
                return (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    'sticky z-30 bg-white dark:bg-slate-900 border-r border-[#eef0f3] dark:border-slate-800',
                    'px-3 text-left group/header relative',
                    'text-[12px] font-medium text-[#8899a6] dark:text-slate-500',
                    // Last pinned column shows inset shadow when scrolled, subtle border otherwise
                    isLastPinned && isScrolled
                      ? 'shadow-[4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.25)]'
                      : 'shadow-[inset_-1px_0_0_0_#eef0f3] dark:shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.06)]',
                    col.sortable && 'cursor-pointer hover:text-[#3C4858] dark:hover:text-slate-300 select-none',
                  )}
                  style={{ left: pinnedLeftOffsets[col.id] }}
                  onClick={() => col.sortable && handleHeaderClick(col.id)}
                  title={sortLabel}
                  aria-sort={
                    sortDir === 'asc' ? 'ascending' :
                    sortDir === 'desc' ? 'descending' : 'none'
                  }
                >
                  <div className="flex items-center truncate">
                    <span className="truncate">{col.header}</span>
                    {col.sortable && <SortIndicator direction={sortDir} sortable />}
                  </div>
                  {col.resizable && (
                    <ResizeHandle
                      columnId={col.id}
                      currentWidth={getColumnWidth(col)}
                      onStartResize={startResize}
                      isResizing={resizingColumnId === col.id}
                    />
                  )}
                </th>
                );
              })}

              {/* Scrollable header cells */}
              {scrollableColumns.map((col) => {
                const sortDir = getSortDirection(col.id);
                const sortLabel = col.sortable
                  ? sortDir === 'asc'
                    ? `Sort by ${col.header} descending`
                    : sortDir === 'desc'
                    ? `Clear sort on ${col.header}`
                    : `Sort by ${col.header} ascending`
                  : undefined;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn(
                      'px-3 text-left group/header relative bg-white dark:bg-slate-900 border-r border-[#eef0f3] dark:border-slate-800',
                      'text-[12px] font-medium text-[#8899a6] dark:text-slate-500',
                      col.sortable && 'cursor-pointer hover:text-[#3C4858] dark:hover:text-slate-300 select-none',
                    )}
                    onClick={() => col.sortable && handleHeaderClick(col.id)}
                    title={sortLabel}
                    aria-sort={
                      sortDir === 'asc' ? 'ascending' :
                      sortDir === 'desc' ? 'descending' : 'none'
                    }
                  >
                    <div className="flex items-center gap-1 truncate">
                      <span className="truncate flex-1">{col.header}</span>
                      {col.sortable && <SortIndicator direction={sortDir} sortable />}
                      {enableColumnMenu && (
                        <ColumnHeaderMenu
                          columnId={col.id}
                          columnLabel={col.header}
                          isRequired={col.required}
                          isPinned={col.pinned === 'left'}
                          sortDirection={sortDir}
                          onSortAsc={(id) => { onSortChange?.({ field: id, direction: 'asc' }); }}
                          onSortDesc={(id) => { onSortChange?.({ field: id, direction: 'desc' }); }}
                          onPinColumn={onPinColumn}
                          onFilterBy={onFilterByColumn}
                          onHideColumn={onHideColumn}
                        />
                      )}
                    </div>
                    {col.resizable && (
                      <ResizeHandle
                        columnId={col.id}
                        currentWidth={getColumnWidth(col)}
                        onStartResize={startResize}
                        isResizing={resizingColumnId === col.id}
                      />
                    )}
                  </th>
                );
              })}

              {/* Pinned right header cells */}
              {pinnedRightColumns.map((col) => {
                const sortDir = getSortDirection(col.id);
                const sortLabel = col.sortable
                  ? sortDir === 'asc'
                    ? `Sort by ${col.header} descending`
                    : sortDir === 'desc'
                    ? `Clear sort on ${col.header}`
                    : `Sort by ${col.header} ascending`
                  : undefined;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn(
                      'sticky right-0 z-30 bg-white dark:bg-slate-900',
                      'px-3 text-left group/header relative',
                      'text-[12px] font-medium text-[#8899a6] dark:text-slate-500',
                      'shadow-[inset_1px_0_0_0_#eef0f3] dark:shadow-[inset_1px_0_0_0_rgba(255,255,255,0.06)]',
                      col.sortable && 'cursor-pointer hover:text-[#3C4858] dark:hover:text-slate-300 select-none',
                    )}
                    onClick={() => col.sortable && handleHeaderClick(col.id)}
                    title={sortLabel}
                    aria-sort={
                      sortDir === 'asc' ? 'ascending' :
                      sortDir === 'desc' ? 'descending' : 'none'
                    }
                  >
                    <div className="flex items-center truncate">
                      <span className="truncate">{col.header}</span>
                      {col.sortable && <SortIndicator direction={sortDir} sortable />}
                    </div>
                    {col.resizable && (
                      <ResizeHandle
                        columnId={col.id}
                        currentWidth={getColumnWidth(col)}
                        onStartResize={startResize}
                        isResizing={resizingColumnId === col.id}
                      />
                    )}
                  </th>
                );
              })}

              {/* Quick actions header spacer */}
              {hasQuickActions && (
                <th
                  scope="col"
                  className="px-3 text-right text-[12px] font-medium text-[#8899a6] dark:text-slate-500"
                >
                  Actions
                </th>
              )}

              {/* Settings icon (⚙) and hidden columns badge at end of header */}
              {showToolbarColumn && (
                <th
                  scope="col"
                  className="px-1 text-center"
                >
                  <div className="flex items-center justify-center gap-1">
                    {/* Hidden columns indicator badge */}
                    {hasHiddenBadge && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md',
                          'text-[10px] font-medium leading-none',
                          'bg-amber-100 text-amber-700',
                          'dark:bg-amber-900/30 dark:text-amber-400',
                        )}
                        aria-label={`${hiddenColumnsCount} column${hiddenColumnsCount === 1 ? '' : 's'} hidden`}
                        title={`${hiddenColumnsCount} column${hiddenColumnsCount === 1 ? '' : 's'} hidden`}
                      >
                        <EyeOff size={10} aria-hidden="true" />
                        {hiddenColumnsCount}
                      </span>
                    )}
                    {onSettingsClick && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSettingsClick(); }}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-600/40 transition-colors"
                        aria-label="Table settings"
                      >
                        <Settings2 size={14} />
                      </button>
                    )}
                  </div>
                </th>
              )}
            </tr>
          </thead>

          {/* ─── Body ──────────────────────────────────────────────── */}
          <tbody className="divide-y divide-[#eef0f3] dark:divide-slate-700/80">
            {sortedData.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0) + (hasQuickActions ? 1 : 0)}
                  className="py-16 text-center"
                >
                  {emptyState?.variant === 'filtered' ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 mb-4">
                        <SearchX className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                      </div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                        {emptyState.title ?? 'No results found'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        {emptyState.description ?? 'No records match your current filters.'}
                      </p>
                      {emptyState.onClearFilters && (
                        <button
                          onClick={emptyState.onClearFilters}
                          className={cn(
                            'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                            'border-slate-300 dark:border-slate-600',
                            'text-slate-700 dark:text-slate-300',
                            'hover:bg-slate-50 dark:hover:bg-slate-800',
                          )}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  ) : emptyState?.variant === 'empty-module' ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 mb-4">
                        <Inbox className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                      </div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                        {emptyState.title ?? 'Nothing here yet'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        {emptyState.description ?? 'Create your first record to get started.'}
                      </p>
                      {emptyState.canCreate && emptyState.onCreateRecord && (
                        <button
                          onClick={emptyState.onCreateRecord}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                            'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700',
                            'text-white',
                          )}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {emptyState.createLabel ?? 'Create record'}
                        </button>
                      )}
                    </div>
                  ) : emptyState?.variant === 'default' ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                        {emptyState.title ?? 'No records found'}
                      </p>
                      {emptyState.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {emptyState.description}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#5A6B85] dark:text-slate-400">
                      {emptyMessage}
                    </p>
                  )}
                </td>
              </tr>
            )}

            {sortedData.map((row, rowIdx) => {
              const rowId = getRowId(row);
              const selected = isSelected(rowId);

              return (
                <DataGridRow<T>
                  key={rowId}
                  row={row}
                  rowId={rowId}
                  rowIdx={rowIdx}
                  selected={selected}
                  selectable={selectable}
                  pinnedLeftColumns={pinnedLeftColumns}
                  scrollableColumns={scrollableColumns}
                  pinnedRightColumns={pinnedRightColumns}
                  pinnedLeftOffsets={pinnedLeftOffsets}
                  isScrolled={isScrolled}
                  viewMode={viewMode}
                  rowHeight={rowHeight}
                  cellContentClass={cellContentClass}
                  hasQuickActions={Boolean(hasQuickActions)}
                  quickActions={quickActions}
                  showToolbarColumn={Boolean(showToolbarColumn)}
                  rowActions={rowActions}
                  hasRowActions={Boolean(rowActions)}
                  onRowClick={onRowClick}
                  toggleRow={toggleRow}
                  renderCellContent={renderCellContent}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Summary Footer (sticky bottom) ────────────────────────── */}
      {(summaryLabel || summaryColumns) && (
        <div
          className={cn(
            'sticky bottom-0 z-20',
            'flex items-center justify-between',
            'px-4 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700',
            'bg-[#F6F8FB] dark:bg-slate-800/60',
            'text-[12px] text-[#5A6B85] dark:text-slate-400',
          )}
        >
          {/* Left: record count / summary label */}
          <span>
            {summaryLabel ?? `${sortedData.length} records`}
          </span>

          {/* Right: column-aligned summaries */}
          {summaryColumns && summaryColumns.length > 0 && (
            <div className="flex items-center gap-4">
              {summaryColumns.map((summary) => (
                <span key={summary.columnId} className="font-medium text-[#0F172A] dark:text-white">
                  {summary.content}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {/* ─── ARIA Live Region for Screen Reader Announcements ────────── */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      >
        {ariaAnnouncement}
      </div>
    </div>
  );
}
