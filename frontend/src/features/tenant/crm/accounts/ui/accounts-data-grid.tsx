/**
 * AccountsDataGrid — Accounts table implemented with the shared DataGrid component.
 *
 * This replaces the legacy flex-based inline layout for the "table" view type,
 * providing:
 * - Sticky header + pinned "Account Name" column on horizontal scroll
 * - Resizable columns via drag handles
 * - Header-click sorting with directional chevrons
 * - Bulk selection (select-all + row checkboxes)
 * - Sticky summary footer with record count
 * - Seamless integration with existing column preference system
 *
 * Filtering/sorting state remains external (owned by accounts-page.tsx)
 * so switching between Table/List/Kanban views retains active filters.
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import { StatusBadge } from '@/shared/components/crm';
import {
  DataGrid,
  useDataGridColumns,
  buildDefaultRowActions,
  renderDate,
  renderLink,
  MODULE_ACCENT_COLORS,
  ACCOUNT_TYPE_VARIANTS,
} from '@/shared/components/data-grid';
import type { SortState, RowActionItem } from '@/shared/components/data-grid';
import type { CellRendererMap } from '@/shared/components/data-grid';
import { ACCOUNTS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import type { ColumnConfigItem } from '@leadcrm/shared';
import type { Account } from '../types/account.types';

// ─── Props Interface ─────────────────────────────────────────────────────────

interface AccountsDataGridProps {
  /** Paginated accounts for the current view */
  accounts: Account[];
  /** Total record count */
  totalRecords: number;
  /** Column preferences from useColumnPreferences */
  effectiveColumns: ColumnConfigItem[];
  /** Current sort state */
  sort?: SortState | null;
  /** Sort change handler */
  onSortChange?: (sort: SortState | null) => void;
  /** Row click → open detail drawer */
  onRowClick: (account: Account) => void;
  /** Selected row IDs */
  selectedIds: Set<string>;
  /** Selection change callback */
  onSelectionChange: (ids: Set<string>) => void;
  /** Lookup: get owner name */
  getOwnerName: (userId?: string) => string;
  /** RBAC: can user edit */
  canEdit?: boolean;
  /** RBAC: can user delete */
  canDelete?: boolean;
  /** Open edit form for an account */
  onEdit?: (account: Account) => void;
  /** Delete an account */
  onDelete?: (account: Account) => void;
  /** Open manage columns drawer */
  onManageColumns?: () => void;
  /** Hide a specific column */
  onHideColumn?: (columnId: string) => void;
  /** Display mode: wrap or clip cell content */
  viewMode?: 'wrap' | 'clip';
}

// ─── Account Type Variant (uses shared ACCOUNT_TYPE_VARIANTS) ────────────────

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountsDataGrid({
  accounts,
  totalRecords,
  effectiveColumns,
  sort = null,
  onSortChange,
  onRowClick,
  selectedIds,
  onSelectionChange,
  getOwnerName,
  canEdit = false,
  canDelete = false,
  onEdit,
  onDelete,
  onManageColumns,
  onHideColumn,
  viewMode = 'clip',
}: AccountsDataGridProps): React.ReactElement {
  // ─── Cell Renderers ────────────────────────────────────────────────────

  const cellRenderers: CellRendererMap<Account> = useMemo(() => ({
    name: (_value: unknown, row: Account) => {
      const initials = (() => {
        const parts = row.name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return row.name.slice(0, 2).toUpperCase();
      })();

      return (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-full ${MODULE_ACCENT_COLORS.accounts} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate leading-tight">
              {row.name}
            </p>
            {row.city && (
              <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate">
                {[row.city, row.country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
      );
    },

    industry: (_value: unknown, row: Account) => (
      <p className="text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate">
        {row.industry ?? '—'}
      </p>
    ),

    customerType: (_value: unknown, row: Account) => (
      <StatusBadge
        label={row.customerType ?? 'Prospect'}
        variant={ACCOUNT_TYPE_VARIANTS[row.customerType ?? 'Prospect'] ?? 'neutral'}
        dot={false}
      />
    ),

    size: (_value: unknown, row: Account) => (
      <p className="text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate">
        {row.size ?? '—'}
      </p>
    ),

    city: (_value: unknown, row: Account) => (
      <p className="text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate">
        {row.city ?? '—'}
      </p>
    ),

    country: (_value: unknown, row: Account) => (
      <p className="text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate">
        {row.country ?? '—'}
      </p>
    ),

    assignedUserId: (_value: unknown, row: Account) => (
      <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {getOwnerName(row.assignedUserId)}
      </p>
    ),

    website: (_value: unknown, row: Account) => renderLink(row.website ?? null),

    tags: (_value: unknown, row: Account) => (
      <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {row.tags && row.tags.length > 0 ? row.tags.join(', ') : '—'}
      </p>
    ),

    createdAt: (_value: unknown, row: Account) => renderDate(row.createdAt),
  }), [getOwnerName]);

  // ─── Column Configuration ──────────────────────────────────────────────

  const { gridColumns } = useDataGridColumns<Account>({
    registry: ACCOUNTS_COLUMN_REGISTRY,
    effectiveColumns,
    cellRenderers,
    sortableColumns: [
      'name', 'industry', 'customerType', 'size',
      'city', 'country', 'assignedUserId', 'createdAt',
    ],
    resizableColumns: 'all',
    defaultWidths: {
      name: 240,
      industry: 160,
      customerType: 140,
      size: 140,
      city: 140,
      country: 140,
      assignedUserId: 160,
      website: 180,
      tags: 160,
      createdAt: 140,
    },
  });

  // ─── Stable Callbacks ────────────────────────────────────────────────

  const getRowId = useCallback((account: Account) => account.id, []);

  // ─── Row Actions (⋯ menu) ─────────────────────────────────────────────

  const getRowActions = useCallback((account: Account): RowActionItem[] => {
    return buildDefaultRowActions({
      onView: () => onRowClick(account),
      onEdit: onEdit ? () => onEdit(account) : undefined,
      onSendEmail: account.email ? () => window.open(`mailto:${account.email}`, '_self') : undefined,
      onDelete: onDelete ? () => onDelete(account) : undefined,
      onCopyUrl: () => {
        navigator.clipboard.writeText(`${window.location.origin}/crm/accounts/${account.id}`);
      },
      canEdit,
      canDelete,
    });
  }, [onRowClick, onEdit, onDelete, canEdit, canDelete]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <DataGrid<Account>
      columns={gridColumns}
      data={accounts}
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
      emptyMessage="No accounts found. Adjust your filters or create a new account."
      ariaLabel="Accounts data grid"
      viewMode={viewMode}
    />
  );
}
