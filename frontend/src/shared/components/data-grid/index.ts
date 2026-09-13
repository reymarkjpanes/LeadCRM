/**
 * DataGrid — Reusable data-grid component for LeadCRM.
 *
 * Public API:
 * - `DataGrid` — the core table component
 * - `DataGridColumnDef` — column definition type (with cell renderer support)
 * - `QuickAction` — inline action button definition
 * - `SummaryColumnDef` — footer summary definition
 * - `useBulkSelection` — selection state management hook
 * - `useColumnResize` — resize handle logic hook
 * - `useDataGridSort` — sort state management hook
 *
 * @example
 * ```tsx
 * import { DataGrid, type DataGridColumnDef } from '@/shared/components/data-grid';
 * ```
 */

// Cell Renderers
export {
  formatDate,
  renderDate,
  renderLink,
  renderStatusBadge,
  renderAvatar,
  renderText,
  getInitials,
  MODULE_ACCENT_COLORS,
  LEAD_STATUS_VARIANTS,
  CONTACT_STATUS_VARIANTS,
  ACCOUNT_TYPE_VARIANTS,
  DEAL_PRIORITY_VARIANTS,
} from './cell-renderers';
export type { StatusVariant, ModuleAccentColor } from './cell-renderers';

// Components
export { DataGrid } from './data-grid';
export { DataGridQuickFilter } from './data-grid-quick-filter';
export type { DataGridQuickFilterProps } from './data-grid-quick-filter';
export { ColumnHeaderMenu } from './column-header-menu';
export type { ColumnHeaderMenuProps } from './column-header-menu';
export { RowActionsMenu, buildDefaultRowActions } from './row-actions-menu';
export type { RowActionsMenuProps, RowActionItem } from './row-actions-menu';
export { ActivityFlag } from './activity-flag';
export type { ActivityFlagProps, ActivityType } from './activity-flag';
export { ColumnsPopover } from './columns-popover';
export type { ColumnsPopoverProps } from './columns-popover';

// Hooks
export { useBulkSelection } from './use-bulk-selection';
export { useColumnResize } from './use-column-resize';
export { useDataGridSort } from './use-data-grid-sort';
export { useDataGridColumns } from './use-data-grid-columns';
export type { CellRendererMap, CellRendererFn } from './use-data-grid-columns';
export { useResponsiveColumns } from './use-responsive-columns';
export { useGridKeyboardNav } from './use-grid-keyboard-nav';

// Types
export type {
  DataGridProps,
  DataGridColumnDef,
  DataGridEmptyStateProps,
  QuickAction,
  SummaryColumnDef,
  SortState,
  SortDirection,
  PinPosition,
  CellRenderContext,
} from './types';
