/**
 * DataGrid Types — Core type definitions for the reusable data-grid component.
 *
 * This is the canonical type source for the entire DataGrid system.
 * All grid features (sorting, resizing, pinning, cell rendering, bulk selection)
 * are driven by these contracts.
 *
 * ## Registering New Columns
 *
 * Define a `DataGridColumnDef<T>` for each column:
 * ```ts
 * const columns: DataGridColumnDef<Lead>[] = [
 *   {
 *     id: 'name',
 *     header: 'Lead Name',
 *     accessor: (row) => row.displayName,
 *     cell: (value, row) => <NameCell name={value} avatar={row.avatar} />,
 *     pinned: 'left',    // pin to left during horizontal scroll
 *     width: 240,
 *     minWidth: 160,
 *     sortable: true,
 *     resizable: true,
 *   },
 * ];
 * ```
 *
 * ## Custom Cell Formatters
 *
 * The `cell` property accepts a render function:
 * ```ts
 * cell: (value, row, context) => <StatusBadge label={value} variant={getVariant(value)} />
 * ```
 *
 * The `context` parameter provides grid-level utilities (e.g., helpers, lookup maps).
 */

import type { ReactNode } from 'react';

// ─── Sort Direction ──────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: string;
  direction: SortDirection;
}

// ─── Column Pin Position ─────────────────────────────────────────────────────

export type PinPosition = 'left' | 'right' | null;

// ─── Cell Render Context ─────────────────────────────────────────────────────

export interface CellRenderContext {
  /** Arbitrary lookup maps or helper functions passed from the parent */
  helpers?: Record<string, unknown>;
  /** Whether the row is currently selected */
  isSelected?: boolean;
  /** Row index in the current page */
  rowIndex?: number;
}

// ─── Column Definition ───────────────────────────────────────────────────────

export interface DataGridColumnDef<T = Record<string, unknown>> {
  /** Unique column identifier */
  id: string;
  /** Header label text */
  header: string;
  /** Data accessor — extracts cell value from a row record */
  accessor: (row: T) => unknown;
  /**
   * Custom cell renderer.
   * When omitted, the grid renders the accessor value as a string.
   */
  cell?: (value: unknown, row: T, context: CellRenderContext) => ReactNode;
  /** Header cell renderer override (for custom header UI) */
  headerCell?: (column: DataGridColumnDef<T>) => ReactNode;
  /** Pin position for horizontal scroll */
  pinned?: PinPosition;
  /** Column width in pixels (initial or current) */
  width?: number;
  /** Minimum width during resize */
  minWidth?: number;
  /** Maximum width during resize */
  maxWidth?: number;
  /** Whether column supports sorting (header click) */
  sortable?: boolean;
  /** Whether column supports drag-to-resize */
  resizable?: boolean;
  /** Whether this column is always visible (cannot be hidden) */
  required?: boolean;
  /** Responsive priority — lower numbers hidden first on small screens */
  priority?: number;
  /** Responsive priority category from column registry — determines hide order as viewport narrows */
  responsivePriority?: 'required' | 'high' | 'medium' | 'low';
  /** Custom sort comparator for non-string values */
  comparator?: (a: T, b: T) => number;
  /** Alignment: left (default), center, right */
  align?: 'left' | 'center' | 'right';
  /** Whether to enable text truncation with ellipsis */
  truncate?: boolean;
}

// ─── Quick Action ────────────────────────────────────────────────────────────

export interface QuickAction<T = Record<string, unknown>> {
  /** Unique action identifier */
  id: string;
  /** Tooltip label */
  label: string;
  /** Icon component or ReactNode */
  icon: ReactNode;
  /** Action callback — receives the row record */
  onClick: (row: T) => void;
  /** Optional visibility predicate */
  visible?: (row: T) => boolean;
}

// ─── Summary Footer Column ───────────────────────────────────────────────────

export interface SummaryColumnDef {
  /** Column ID this summary aligns to */
  columnId: string;
  /** Rendered content (count, sum, average, etc.) */
  content: ReactNode;
}

// ─── DataGrid Props ──────────────────────────────────────────────────────────

export interface DataGridProps<T = Record<string, unknown>> {
  /** Column definitions */
  columns: DataGridColumnDef<T>[];
  /** Data rows for the current page */
  data: T[];
  /** Unique key extractor for each row */
  getRowId: (row: T) => string;
  /** Grid height — 'auto' | fixed px number | CSS string */
  height?: 'auto' | number | string;
  /** Compact row mode (44px vs 52px) */
  dense?: boolean;
  /** Loading state */
  isLoading?: boolean;
  /** Empty state custom message */
  emptyMessage?: string;

  // ─── Sorting ────────────────────────────────────────────────────────────
  /** Current sort state (single or multi) */
  sort?: SortState | null;
  /** Sort change handler */
  onSortChange?: (sort: SortState | null) => void;

  // ─── Row Selection ──────────────────────────────────────────────────────
  /** Enable row selection checkboxes */
  selectable?: boolean;
  /** Set of selected row IDs */
  selectedIds?: Set<string>;
  /** Selection change callback */
  onSelectionChange?: (selectedIds: Set<string>) => void;

  // ─── Row Click ──────────────────────────────────────────────────────────
  /** Row click handler (opens detail drawer etc.) */
  onRowClick?: (row: T) => void;

  // ─── Quick Actions ──────────────────────────────────────────────────────
  /** Inline quick-action icons (call, email, star) displayed on hover */
  quickActions?: QuickAction<T>[];

  // ─── Summary Footer ─────────────────────────────────────────────────────
  /** Summary/calculation row at the bottom */
  summaryColumns?: SummaryColumnDef[];
  /** Summary leading text (e.g., "23 records") */
  summaryLabel?: string;

  // ─── Column Resize ──────────────────────────────────────────────────────
  /** Column widths state (controlled) — maps column id to pixel width */
  columnWidths?: Record<string, number>;
  /** Column resize callback (fires per animation frame during drag for live preview) */
  onColumnResize?: (columnId: string, width: number) => void;
  /** Column width change callback (fires once on pointer-up for persistence) */
  onColumnWidthChange?: (columnId: string, width: number) => void;

  // ─── Cell Render Context ────────────────────────────────────────────────
  /** Additional context passed to all cell renderers */
  cellContext?: Record<string, unknown>;

  // ─── Accessibility ──────────────────────────────────────────────────────
  /** ARIA label for the grid region */
  ariaLabel?: string;

  // ─── Column Header Menu ─────────────────────────────────────────────────
  /** Enable column header menu (≡ icon with Asc, Desc, Pin, Filter, Hide) */
  enableColumnMenu?: boolean;
  /** Callback when "Pin Column" is clicked */
  onPinColumn?: (columnId: string) => void;
  /** Callback when "Filter by" is clicked */
  onFilterByColumn?: (columnId: string) => void;
  /** Callback when "Hide Column" is clicked */
  onHideColumn?: (columnId: string) => void;

  // ─── Row Actions Menu ───────────────────────────────────────────────────
  /** Row actions builder — receives row record, returns action items */
  rowActions?: (row: T) => import('./row-actions-menu').RowActionItem[];

  // ─── View Mode ──────────────────────────────────────────────────────────
  /** Display mode for cell content: 'wrap' shows multi-line, 'clip' truncates */
  viewMode?: 'wrap' | 'clip';

  // ─── Empty State ────────────────────────────────────────────────────────
  /** Contextual empty state configuration */
  emptyState?: DataGridEmptyStateProps;

  // ─── Settings Icon ──────────────────────────────────────────────────────
  /** Callback when settings (⚙) icon at end of header is clicked */
  onSettingsClick?: () => void;

  // ─── Hidden Columns Indicator ─────────────────────────────────────────
  /** Count of columns auto-hidden by the responsive column strategy */
  hiddenColumnsCount?: number;
}

// ─── Empty State Types ────────────────────────────────────────────────────────

export interface DataGridEmptyStateProps {
  /** 'filtered': records exist but none match filters — show "clear filters" */
  /** 'empty-module': module has zero records — show "create" action */
  /** 'default': plain text message with no action buttons */
  variant: 'filtered' | 'empty-module' | 'default';
  /** Title text */
  title?: string;
  /** Description text */
  description?: string;
  /** Called when user clicks "Clear filters" (only for 'filtered' variant) */
  onClearFilters?: () => void;
  /** Called when user clicks "Create" button (only for 'empty-module' variant) */
  onCreateRecord?: () => void;
  /** Label for create button — e.g. "New Lead" */
  createLabel?: string;
  /** Whether the create button should render (RBAC-gated by caller) */
  canCreate?: boolean;
}
