/**
 * ContactsDataGrid — Contacts table implemented with the shared DataGrid component.
 *
 * This replaces the legacy flex-based inline layout for the "table" view type,
 * providing:
 * - Sticky header + pinned "First Name" column on horizontal scroll
 * - Resizable columns via drag handles
 * - Header-click sorting with directional chevrons
 * - Bulk selection (select-all + row checkboxes)
 * - Sticky summary footer with record count
 * - Seamless integration with existing column preference system
 *
 * Filtering/sorting state remains external (owned by contacts-page.tsx)
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
  CONTACT_STATUS_VARIANTS,
} from '@/shared/components/data-grid';
import type { SortState, RowActionItem } from '@/shared/components/data-grid';
import type { CellRendererMap } from '@/shared/components/data-grid';
import { CONTACTS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import type { ColumnConfigItem } from '@leadcrm/shared';
import type { Contact } from '@/store/types';

// ─── Props Interface ─────────────────────────────────────────────────────────

interface ContactsDataGridProps {
  /** Paginated contacts for the current view */
  contacts: Contact[];
  /** Total record count */
  totalRecords: number;
  /** Column preferences from useColumnPreferences */
  effectiveColumns: ColumnConfigItem[];
  /** Current sort state */
  sort?: SortState | null;
  /** Sort change handler */
  onSortChange?: (sort: SortState | null) => void;
  /** Row click → open detail drawer */
  onRowClick: (contact: Contact) => void;
  /** Selected row IDs */
  selectedIds: Set<string>;
  /** Selection change callback */
  onSelectionChange: (ids: Set<string>) => void;
  /** Lookup: get account/company name */
  getAccountName: (contact: Contact) => string;
  /** Lookup: get assigned user name */
  getAssignedUserName: (userId?: string) => string;
  /** RBAC: can user edit */
  canEdit?: boolean;
  /** RBAC: can user delete */
  canDelete?: boolean;
  /** Open edit form for a contact */
  onEdit?: (contact: Contact) => void;
  /** Delete a contact */
  onDelete?: (contact: Contact) => void;
  /** Open manage columns drawer */
  onManageColumns?: () => void;
  /** Hide a specific column */
  onHideColumn?: (columnId: string) => void;
  /** Display mode: wrap or clip cell content */
  viewMode?: 'wrap' | 'clip';
}

// ─── Status Variant Map (uses shared CONTACT_STATUS_VARIANTS) ────────────────

// ─── Component ───────────────────────────────────────────────────────────────

export function ContactsDataGrid({
  contacts,
  totalRecords,
  effectiveColumns,
  sort = null,
  onSortChange,
  onRowClick,
  selectedIds,
  onSelectionChange,
  getAccountName,
  getAssignedUserName,
  canEdit = false,
  canDelete = false,
  onEdit,
  onDelete,
  onManageColumns,
  onHideColumn,
  viewMode = 'clip',
}: ContactsDataGridProps): React.ReactElement {
  // ─── Cell Renderers ────────────────────────────────────────────────────

  const cellRenderers: CellRendererMap<Contact> = useMemo(() => ({
    firstName: (_value: unknown, row: Contact) => {
      const name = row.contactPerson ?? row.leadPerson ?? (`${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Unknown');
      const initials = (() => {
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
      })();

      return (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-full ${MODULE_ACCENT_COLORS.contacts} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate leading-tight">
              {row.firstName ?? name.split(' ')[0] ?? '—'}
            </p>
          </div>
        </div>
      );
    },

    lastName: (_value: unknown, row: Contact) => (
      <p className="text-[13px] text-[#0F172A] dark:text-slate-200 truncate">
        {row.lastName ?? '—'}
      </p>
    ),

    email: (_value: unknown, row: Contact) => (
      <p className="text-[12px] text-[#0F172A] dark:text-slate-200 truncate">{row.email ?? '—'}</p>
    ),

    phone: (_value: unknown, row: Contact) => (
      <p className="text-[12px] text-[#0F172A] dark:text-slate-200 truncate">{row.phone ?? '—'}</p>
    ),

    companyName: (_value: unknown, row: Contact) => {
      const accountName = getAccountName(row);
      return renderLink(accountName || null);
    },

    status: (_value: unknown, row: Contact) => (
      <StatusBadge
        label={row.status ?? 'Active'}
        variant={CONTACT_STATUS_VARIANTS[row.status ?? 'Active'] ?? 'neutral'}
      />
    ),

    source: (_value: unknown, row: Contact) => (
      <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {(row as unknown as Record<string, unknown>).source as string ?? '—'}
      </p>
    ),

    assignedUserId: (_value: unknown, row: Contact) => (
      <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {getAssignedUserName(row.assignedUserId)}
      </p>
    ),

    accountId: (_value: unknown, row: Contact) => (
      <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
        {getAccountName(row)}
      </p>
    ),

    createdAt: (_value: unknown, row: Contact) => renderDate(row.createdAt),
  }), [getAccountName, getAssignedUserName]);

  // ─── Column Configuration ──────────────────────────────────────────────

  const { gridColumns } = useDataGridColumns<Contact>({
    registry: CONTACTS_COLUMN_REGISTRY,
    effectiveColumns,
    cellRenderers,
    sortableColumns: [
      'firstName', 'lastName', 'email', 'phone', 'companyName',
      'status', 'source', 'assignedUserId', 'createdAt',
    ],
    resizableColumns: 'all',
    defaultWidths: {
      firstName: 200,
      lastName: 160,
      email: 220,
      phone: 150,
      companyName: 180,
      status: 120,
      source: 140,
      assignedUserId: 160,
      accountId: 180,
      createdAt: 140,
    },
  });

  // ─── Stable Callbacks ────────────────────────────────────────────────

  const getRowId = useCallback((contact: Contact) => contact.id, []);

  // ─── Row Actions (⋯ menu) ─────────────────────────────────────────────

  const getRowActions = useCallback((contact: Contact): RowActionItem[] => {
    return buildDefaultRowActions({
      onView: () => onRowClick(contact),
      onEdit: onEdit ? () => onEdit(contact) : undefined,
      onSendEmail: contact.email ? () => window.open(`mailto:${contact.email}`, '_self') : undefined,
      onDelete: onDelete ? () => onDelete(contact) : undefined,
      onCopyUrl: () => {
        navigator.clipboard.writeText(`${window.location.origin}/crm/contacts/${contact.id}`);
      },
      canEdit,
      canDelete,
    });
  }, [onRowClick, onEdit, onDelete, canEdit, canDelete]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <DataGrid<Contact>
      columns={gridColumns}
      data={contacts}
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
      emptyMessage="No contacts found. Adjust your filters or create a new contact."
      ariaLabel="Contacts data grid"
      viewMode={viewMode}
    />
  );
}
