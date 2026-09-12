/**
 * DealsDataGrid — Deals table implemented with the shared DataGrid component.
 *
 * Replaces the legacy DealsTable for the "table" view type,
 * providing column preferences, sorting, bulk selection, row actions,
 * column resize, and view mode (wrap/clip) support.
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import type { Deal } from '@/store/types';
import type { ColumnConfigItem } from '@leadcrm/shared';
import type { SortState } from '@/shared/components/data-grid';
import { StatusBadge } from '@/shared/components/crm';
import {
  DataGrid,
  useDataGridColumns,
  buildDefaultRowActions,
  renderDate,
  renderLink,
  MODULE_ACCENT_COLORS,
  DEAL_PRIORITY_VARIANTS,
} from '@/shared/components/data-grid';
import type { CellRendererMap, RowActionItem } from '@/shared/components/data-grid';
import { DEALS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { formatCurrency, type CurrencyConfig } from '@/shared/utils/currency';

// ─── Props Interface ─────────────────────────────────────────────────────────

interface DealsDataGridProps {
  /** Paginated deals for the current view */
  deals: Deal[];
  /** Total record count */
  totalRecords: number;
  /** Column preferences from useColumnPreferences */
  effectiveColumns: ColumnConfigItem[];
  /** Current sort state */
  sort?: SortState | null;
  /** Sort change handler */
  onSortChange?: (sort: SortState | null) => void;
  /** Row click → open detail modal */
  onRowClick: (deal: Deal) => void;
  /** Selected row IDs */
  selectedIds: Set<string>;
  /** Selection change callback */
  onSelectionChange: (ids: Set<string>) => void;
  /** Stage name lookup */
  stageNameMap: Record<string, string>;
  /** Pipeline name lookup (reserved for future pipeline column) */
  pipelineNameMap?: Record<string, string>;
  /** Lookup: get assigned user name */
  getAssignedUserName: (userId?: string) => string;
  /** Lookup: get account name */
  getAccountName: (accountId?: string) => string;
  /** RBAC: can user edit */
  canEdit?: boolean;
  /** RBAC: can user delete */
  canDelete?: boolean;
  /** Open edit for a deal */
  onEdit?: (deal: Deal) => void;
  /** Delete a deal */
  onDelete?: (deal: Deal) => void;
  /** Open manage columns drawer */
  onManageColumns?: () => void;
  /** Hide a specific column */
  onHideColumn?: (columnId: string) => void;
  /** Display mode: wrap or clip cell content */
  viewMode?: 'wrap' | 'clip';
  /** Tenant currency configuration for formatting monetary values */
  currencyConfig?: CurrencyConfig;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DealsDataGrid({
  deals,
  totalRecords,
  effectiveColumns,
  sort = null,
  onSortChange,
  onRowClick,
  selectedIds,
  onSelectionChange,
  stageNameMap,
  // pipelineNameMap available via props if pipeline column is added
  getAssignedUserName,
  getAccountName,
  canEdit = false,
  canDelete = false,
  onEdit,
  onDelete,
  onManageColumns,
  onHideColumn,
  viewMode = 'clip',
  currencyConfig,
}: DealsDataGridProps): React.ReactElement {
  // ─── Cell Renderers ────────────────────────────────────────────────────

  const cellRenderers: CellRendererMap<Deal> = useMemo(() => ({
    title: (_value: unknown, row: Deal) => {
      const name = row.title || 'Untitled Deal';
      const initials = (() => {
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
      })();

      return (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-full ${MODULE_ACCENT_COLORS.deals} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate leading-tight">
              {row.title}
            </p>
            {row.companyName && (
              <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate">
                {row.companyName}
              </p>
            )}
          </div>
        </div>
      );
    },

    value: (_value: unknown, row: Deal) => (
      <span className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
        {typeof row.value === 'number' && row.value > 0 ? formatCurrency(row.value, currencyConfig) : '—'}
      </span>
    ),

    stageId: (_value: unknown, row: Deal) => {
      const stageName = stageNameMap[row.stageId] ?? '—';
      return (
        <StatusBadge label={stageName} variant="info" />
      );
    },

    priority: (_value: unknown, row: Deal) => {
      const p = row.priority ?? 'Medium';
      return (
        <StatusBadge
          label={p}
          variant={DEAL_PRIORITY_VARIANTS[p] ?? 'neutral'}
        />
      );
    },

    assignedUserId: (_value: unknown, row: Deal) => (
      <span className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {getAssignedUserName(row.assignedUserId)}
      </span>
    ),

    accountId: (_value: unknown, row: Deal) => {
      const accountName = getAccountName(row.organizationId);
      return renderLink(accountName || null);
    },

    expectedCloseDate: (_value: unknown, row: Deal) => renderDate(row.expectedCloseDate),

    leadSource: (_value: unknown, row: Deal) => (
      <span className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {row.leadSource ?? '—'}
      </span>
    ),

    industry: (_value: unknown, row: Deal) => (
      <span className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {(row as unknown as Record<string, unknown>).industry as string ?? '—'}
      </span>
    ),

    createdAt: (_value: unknown, row: Deal) => renderDate(row.createdAt),
  }), [stageNameMap, getAssignedUserName, getAccountName, currencyConfig]);

  // ─── Column Configuration ──────────────────────────────────────────────

  const { gridColumns } = useDataGridColumns<Deal>({
    registry: DEALS_COLUMN_REGISTRY,
    effectiveColumns,
    cellRenderers,
    pinnedColumns: ['title'],
    sortableColumns: ['title', 'value', 'stageId', 'priority', 'expectedCloseDate', 'createdAt'],
    resizableColumns: 'all',
    defaultWidths: {
      title: 240,
      value: 140,
      stageId: 140,
      priority: 110,
      assignedUserId: 160,
      accountId: 160,
      expectedCloseDate: 140,
      leadSource: 130,
      industry: 130,
      createdAt: 140,
    },
  });

  // ─── Stable Callbacks ────────────────────────────────────────────────

  const getRowId = useCallback((deal: Deal) => deal.id, []);

  // ─── Row Actions (⋯ menu) ─────────────────────────────────────────────

  const getRowActions = useCallback((deal: Deal): RowActionItem[] => {
    return buildDefaultRowActions({
      onView: () => onRowClick(deal),
      onEdit: onEdit ? () => onEdit(deal) : undefined,
      onDelete: onDelete ? () => onDelete(deal) : undefined,
      canEdit,
      canDelete,
    });
  }, [onRowClick, onEdit, onDelete, canEdit, canDelete]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <DataGrid<Deal>
      columns={gridColumns}
      data={deals}
      getRowId={getRowId}
      height={600}
      selectable
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      sort={sort}
      onSortChange={onSortChange}
      onRowClick={onRowClick}
      onHideColumn={onHideColumn}
      rowActions={getRowActions}
      onSettingsClick={onManageColumns}
      summaryLabel={`${totalRecords} total records`}
      emptyMessage="No deals found. Adjust your filters or create a new deal."
      ariaLabel="Deals data grid"
      viewMode={viewMode}
    />
  );
}
