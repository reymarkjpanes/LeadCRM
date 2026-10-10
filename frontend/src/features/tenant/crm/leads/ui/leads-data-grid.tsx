/**
 * LeadsDataGrid — Leads table implemented with the shared DataGrid component.
 *
 * Close.com-style features:
 * - Status rendered as colored dot + plain text (no pill badge)
 * - Dedicated clickable Phone and Email icon columns (between Name and Email)
 * - Name column pinned left and always visible
 * - Sticky header with resizable, reorderable columns
 * - Bulk selection, quick actions, column header menu
 */

'use client';

import { useRouter } from 'next/navigation';
import { recordEmailComposeHref } from '@/features/tenant/inbox/services/compose-navigation';
import React, { useMemo, useCallback } from 'react';
import { Phone, Mail, ExternalLink, GitMerge } from 'lucide-react';
import {
  DataGrid,
  DataGridQuickFilter,
  useDataGridColumns,
  buildDefaultRowActions,
  renderDate,
  MODULE_ACCENT_COLORS,
} from '@/shared/components/data-grid';
import type { SortState, RowActionItem } from '@/shared/components/data-grid';
import type { CellRendererMap } from '@/shared/components/data-grid';
import { LEADS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import type { ColumnConfigItem } from '@leadcrm/shared';
import { CrmStatusIndicator } from '@/shared/components/crm/crm-status';
import type { Lead } from '@/store/types';

// ─── Status Dot Colors (Close.com style) ─────────────────────────────────────



// ─── Helper: Render user with avatar initials ─────────────────────────────────

function renderUserName(
  user?: { id: string; firstName: string; lastName: string } | null,
): React.ReactNode {
  if (!user) return <span className="text-[12px] text-[#94a3b8]">—</span>;
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
  const name = `${user.firstName} ${user.lastName}`.trim();
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
        {initials}
      </div>
      <span className="text-[12px] text-[#3C4858] dark:text-slate-300 truncate max-w-[100px]">
        {name}
      </span>
    </div>
  );
}

// ─── Props Interface ─────────────────────────────────────────────────────────

interface LeadsDataGridProps {
  /** Paginated leads for the current view */
  leads: Lead[];
  /** Total record count (unfiltered or after filters) */
  totalRecords: number;
  /** Column preferences from useColumnPreferences */
  effectiveColumns: ColumnConfigItem[];
  /** Current sort state */
  sort?: SortState | null;
  /** Sort change handler */
  onSortChange?: (sort: SortState | null) => void;
  /** Row click → open detail drawer */
  onRowClick: (lead: Lead) => void;
  /** Selected row IDs */
  selectedIds: Set<string>;
  /** Selection change callback */
  onSelectionChange: (ids: Set<string>) => void;
  /** Quick-filter search value (optional in-grid filter) */
  quickFilterValue?: string;
  /** Quick-filter change handler */
  onQuickFilterChange?: (value: string) => void;
  /** Lookup helpers */
  getOwnerName: (userId?: string) => string;
  getOwnerInitials: (userId?: string) => string;
  /** RBAC: can user edit */
  canEdit?: boolean;
  /** RBAC: can user archive */
  canArchive?: boolean;
  /** Open edit form for a lead */
  onEdit?: (lead: Lead) => void;
  /** Archive a lead */
  onArchive?: (lead: Lead) => void;
  /** Convert a lead */
  onConvert?: (lead: Lead) => void;
  /** Merge a lead with another */
  onMerge?: (lead: Lead) => void;
  /** Open manage columns drawer */
  onManageColumns?: () => void;
  /** Hide a specific column */
  onHideColumn?: (columnId: string) => void;
  /** Display mode: wrap or clip cell content */
  viewMode?: 'wrap' | 'clip';
  /** Row ID to highlight (navigated from global search) */
  highlightRowId?: string;
}

// ─── Status Variant Map (uses shared LEAD_STATUS_VARIANTS) ───────────────────

// ─── Component ───────────────────────────────────────────────────────────────

export function LeadsDataGrid({
  leads,
  totalRecords,
  effectiveColumns,
  sort = null,
  onSortChange,
  onRowClick,
  selectedIds,
  onSelectionChange,
  quickFilterValue,
  onQuickFilterChange,
  getOwnerName,
  getOwnerInitials,
  canEdit = false,
  canArchive = false,
  onEdit,
  onArchive,
  onConvert,
  onMerge,
  onManageColumns,
  onHideColumn,
  viewMode = 'clip',
  highlightRowId,
}: LeadsDataGridProps): React.ReactElement {
  // ─── Cell Renderers ────────────────────────────────────────────────────

  const router = useRouter();
  const cellRenderers: CellRendererMap<Lead> = useMemo(() => ({

    // ── Name (pinned left) ─────────────────────────────────────────────
    firstName: (_value: unknown, row: Lead) => {
      const name = row.leadPerson ?? row.displayName ?? (`${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Unknown');
      const initials = (() => {
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
      })();
      return (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-full ${MODULE_ACCENT_COLORS.leads} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[#1a73e8] dark:text-blue-400 truncate leading-tight hover:underline cursor-pointer">
              {name}
            </p>
            {row.companyName && (
              <p className="text-[11px] text-[#8899a6] dark:text-slate-500 truncate">
                {row.companyName}
              </p>
            )}
          </div>
        </div>
      );
    },

    // ── Phone icon column (clickable) ──────────────────────────────────
    phoneAction: (_value: unknown, row: Lead) => {
      if (!row.phone) return <span className="text-[#d1d5db] select-none text-center block">—</span>;
      return (
        <a
          href={`tel:${row.phone}`}
          title={row.phone}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[#5A6B85] hover:text-[#1a73e8] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Phone size={14} />
        </a>
      );
    },

    // ── Email icon column (clickable) ──────────────────────────────────
    emailAction: (_value: unknown, row: Lead) => {
      if (!row.email) return <span className="text-[#d1d5db] select-none text-center block">—</span>;
      return (
        <a
          href={recordEmailComposeHref(row.email ?? '') ?? undefined}
          title={row.email}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[#5A6B85] hover:text-[#1a73e8] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Mail size={14} />
        </a>
      );
    },

    email: (_value: unknown, row: Lead) => (
      <p className="text-[12px] text-[#3C4858] dark:text-slate-200 truncate">{row.email ?? '—'}</p>
    ),

    phone: (_value: unknown, row: Lead) => (
      <p className="text-[12px] text-[#3C4858] dark:text-slate-200 truncate">{row.phone ?? '—'}</p>
    ),

    companyName: (_value: unknown, row: Lead) => (
      <p className="text-[13px] text-[#3C4858] dark:text-slate-200 truncate">{row.companyName ?? '—'}</p>
    ),

    // ── Status: Close.com dot + plain text ────────────────────────────
    status: (_value: unknown, row: Lead) => <CrmStatusIndicator status={row.status} />,

    source: (_value: unknown, row: Lead) => (
      <p className="text-[12px] text-[#8899a6] dark:text-slate-400 truncate">{row.leadSource ?? row.source ?? '—'}</p>
    ),

    assignedUserId: (_value: unknown, row: Lead) => (
      <div className="flex items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
          {row.assignedUser
            ? `${row.assignedUser.firstName?.[0] ?? ''}${row.assignedUser.lastName?.[0] ?? ''}` || getOwnerInitials(row.assignedUserId)
            : getOwnerInitials(row.assignedUserId)}
        </div>
        <span className="text-[12px] text-[#3C4858] dark:text-slate-400 truncate max-w-[100px]">
          {row.assignedUser
            ? `${row.assignedUser.firstName} ${row.assignedUser.lastName}`.trim() || getOwnerName(row.assignedUserId)
            : getOwnerName(row.assignedUserId)}
        </span>
      </div>
    ),

    createdAt: (_value: unknown, row: Lead) => renderDate(row.createdAt),

    updatedAt: (_value: unknown, row: Lead) => {
      const val = (row as unknown as Record<string, unknown>).updatedAt as string | undefined;
      return renderDate(val);
    },

    lastStatusChangedAt: (_value: unknown, row: Lead) => renderDate(row.lastStatusChangedAt),
    latestStatusChangeDate: (_value: unknown, row: Lead) => renderDate(row.lastStatusChangedAt),

    website: (_value: unknown, row: Lead) => {
      const url = row.website;
      if (!url) return <span className="text-[12px] text-[#94a3b8]">—</span>;
      return (
        <a
          href={url.startsWith('http') ? url : `https://${url}`}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[12px] text-[#1a73e8] hover:underline truncate"
        >
          {url.replace(/^https?:\/\//, '')}
          <ExternalLink size={11} className="shrink-0" />
        </a>
      );
    },

    description: (_value: unknown, row: Lead) => {
      const desc = row.description;
      if (!desc) return <span className="text-[12px] text-[#94a3b8]">—</span>;
      return <p className="text-[12px] text-[#3C4858] dark:text-slate-300 truncate" title={desc}>{desc}</p>;
    },

    createdBy: (_value: unknown, row: Lead) => renderUserName(row.createdByUser),
    updatedBy: (_value: unknown, row: Lead) => renderUserName(row.updatedByUser),

    address: (_value: unknown, row: Lead) => (
      <p className="text-[12px] text-[#3C4858] dark:text-slate-300 truncate">{row.address ?? row.streetAddress ?? '—'}</p>
    ),

    primaryAddressCityState: (_value: unknown, row: Lead) => {
      const parts = [row.city, row.province].filter(Boolean).join(', ');
      return <p className="text-[12px] text-[#3C4858] dark:text-slate-300 truncate">{parts || '—'}</p>;
    },

    productInterest: (_value: unknown, row: Lead) => {
      const interests = row.productInterests ?? (Array.isArray(row.productInterest)
        ? row.productInterest : row.productInterest ? [row.productInterest] : []);
      if (!interests.length) return <span className="text-[12px] text-[#94a3b8]">—</span>;
      return (
        <div className="flex flex-wrap gap-1 min-w-0">
          {interests.slice(0, 2).map((item: string) => (
            <span key={item} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-[#5A6B85] dark:text-slate-300 truncate max-w-[80px]">
              {item}
            </span>
          ))}
          {interests.length > 2 && (
            <span className="text-[10px] text-[#94a3b8]">+{interests.length - 2}</span>
          )}
        </div>
      );
    },

  }), [getOwnerName, getOwnerInitials]);

  // ─── Column Configuration ──────────────────────────────────────────────

  const { gridColumns } = useDataGridColumns<Lead>({
    registry: LEADS_COLUMN_REGISTRY,
    effectiveColumns,
    cellRenderers,
    sortableColumns: [
      'firstName', 'email', 'phone', 'companyName', 'status',
      'source', 'createdAt', 'updatedAt',
    ],
    resizableColumns: 'all',
    defaultWidths: {
      firstName:               240,
      phoneAction:             52,
      emailAction:             52,
      email:                   200,
      phone:                   150,
      companyName:             180,
      status:                  130,
      source:                  140,
      assignedUserId:          160,
      createdAt:               140,
      updatedAt:               140,
      lastStatusChangedAt:     150,
      latestStatusChangeDate:  150,
      description:             220,
      website:                 180,
      address:                 200,
      primaryAddressCityState: 160,
      productInterest:         180,
      createdBy:               150,
      updatedBy:               150,
    },
  });

  // ─── Stable Callbacks ────────────────────────────────────────────────

  const getRowId = useCallback((lead: Lead) => lead.id, []);

  // ─── Row Actions (⋯ menu) ─────────────────────────────────────────────

  const getRowActions = useCallback((lead: Lead): RowActionItem[] => {
    const actions = buildDefaultRowActions({
      onView: () => onRowClick(lead),
      onEdit: onEdit ? () => onEdit(lead) : undefined,
      onSendEmail: lead.email ? () => router.push(recordEmailComposeHref(lead.email ?? '') ?? '/inbox') : undefined,
      onConvert: canEdit && onConvert ? () => onConvert(lead) : undefined,
      onArchive: onArchive ? () => onArchive(lead) : undefined,
      onCopyUrl: () => {
        navigator.clipboard.writeText(`${window.location.origin}/crm/leads/${lead.id}`);
      },
      canEdit,
      canArchive,
    });

    // Add Merge action (if user can edit)
    if (onMerge && canEdit) {
      const convertIdx = actions.findIndex((a) => a.id === 'convert');
      const insertAt = convertIdx >= 0 ? convertIdx + 1 : actions.length - 1;
      actions.splice(insertAt, 0, {
        id: 'merge',
        label: 'Merge with...',
        icon: <GitMerge size={14} />,
        onClick: () => onMerge(lead),
      });
    }

    return actions;
  }, [onRowClick, onEdit, onArchive, onConvert, onMerge, canEdit, canArchive]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Quick Filter Bar */}
      {onQuickFilterChange && (
        <DataGridQuickFilter
          value={quickFilterValue ?? ''}
          onChange={onQuickFilterChange}
          placeholder="Quick filter leads..."
          totalCount={leads.length}
        />
      )}

      {/* Data Grid */}
      <DataGrid<Lead>
        columns={gridColumns}
        data={leads}
        getRowId={getRowId}
        height="auto"
        selectable
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        sortingMode="external"
        sort={sort}
        onSortChange={onSortChange}
        onRowClick={onRowClick}
        onHideColumn={onHideColumn}
        rowActions={getRowActions}
        onSettingsClick={onManageColumns}
        summaryLabel={`${totalRecords} total records`}
        emptyMessage="No leads found. Adjust your filters or create a new lead."
        ariaLabel="Leads data grid"
        highlightRowId={highlightRowId}
        viewMode={viewMode}
      />
    </div>
  );
}
