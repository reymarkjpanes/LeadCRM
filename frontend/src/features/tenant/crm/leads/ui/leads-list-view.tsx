'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Lead } from '@/store/types';
import { StatusBadge } from '@/shared/components/crm';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import type { ColumnConfigItem, ColumnDefinition } from '@leadcrm/shared';

// ── Responsive Column Helpers ─────────────────────────────────────────────────

/**
 * Determines the responsive CSS class for a column based on its position
 * among non-required visible columns.
 *
 * - Required columns: always visible (no hiding class)
 * - Non-required index 0-1 (first 2): always visible
 * - Non-required index 2-3 (3rd & 4th): hidden below md (768px)
 * - Non-required index 4+ (5th+): hidden below lg (1024px)
 */
export function getResponsiveColumnClass(
  colId: string,
  visibleColumns: ColumnConfigItem[],
  registry: ColumnDefinition[],
): string {
  const regDef = registry.find((r) => r.id === colId);
  if (regDef?.required) return ''; // Required columns are always visible

  const nonRequiredVisible = visibleColumns.filter((c) => {
    const def = registry.find((r) => r.id === c.id);
    return !def?.required;
  });
  const idx = nonRequiredVisible.findIndex((c) => c.id === colId);

  if (idx < 0) return 'hidden';
  if (idx < 2) return '';
  if (idx < 4) return 'hidden md:block';
  return 'hidden lg:block';
}

// ── Sortable Columns ──────────────────────────────────────────────────────────

const SORTABLE_COLUMNS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'companyName',
  'status', 'source', 'assignedUserId', 'createdAt', 'updatedAt',
]);

// ── Sort Types ────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';

interface SortState {
  field: string;
  direction: SortDirection;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeadsListViewProps {
  leads: Lead[];
  totalRecords: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  viewMode: 'wrap' | 'clip';
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onRowClick: (lead: Lead) => void;
  getInitials: (lead: Lead) => string;
  getLeadName: (lead: Lead) => string;
  getOwnerName: (userId?: string) => string;
  getOwnerInitials: (userId?: string) => string;
  getStatusVariant: (status: string) => 'success' | 'info' | 'warn' | 'danger' | 'purple' | 'neutral';
  formatCurrency?: (value?: number) => string;
  visibleColumns: ColumnConfigItem[];
  registry: ColumnDefinition[];
  dense?: boolean;
  /** @deprecated Column drag-and-drop has been removed. This prop is ignored. */
  onColumnsReorder?: (newColumns: ColumnConfigItem[]) => void;
}

// ── Sort Indicator ────────────────────────────────────────────────────────────

interface SortIndicatorProps {
  direction: SortDirection | null;
}

function SortIndicator({ direction }: SortIndicatorProps): React.ReactElement {
  if (direction === 'asc') {
    return <ChevronUp size={12} className="ml-1 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />;
  }
  if (direction === 'desc') {
    return <ChevronDown size={12} className="ml-1 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />;
  }
  return <ChevronsUpDown size={12} className="ml-1 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeadsListView({
  leads,
  totalRecords,
  currentPage,
  pageSize,
  totalPages,
  onPageChange,
  viewMode,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  getInitials,
  getLeadName,
  getOwnerName,
  getOwnerInitials,
  getStatusVariant,
  visibleColumns,
  registry,
  dense = false,
}: LeadsListViewProps): React.ReactElement {
  // ── Sort State ───────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortState | null>(null);

  const handleHeaderClick = useCallback((colId: string) => {
    if (!SORTABLE_COLUMNS.has(colId)) return;
    setSort((prev) => {
      if (!prev || prev.field !== colId) return { field: colId, direction: 'asc' };
      if (prev.direction === 'asc') return { field: colId, direction: 'desc' };
      return null; // third click clears sort
    });
  }, []);

  const getSortDirection = useCallback(
    (colId: string): SortDirection | null => {
      if (!sort || sort.field !== colId) return null;
      return sort.direction;
    },
    [sort],
  );

  // ── Sort Comparator ──────────────────────────────────────────────────────
  const sortedLeads = useMemo(() => {
    if (!sort) return leads;

    return [...leads].sort((a, b) => {
      let aVal: unknown;
      let bVal: unknown;

      switch (sort.field) {
        case 'firstName':
          aVal = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim().toLowerCase();
          bVal = `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim().toLowerCase();
          break;
        case 'lastName':
          aVal = (a.lastName ?? '').toLowerCase();
          bVal = (b.lastName ?? '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email ?? '').toLowerCase();
          bVal = (b.email ?? '').toLowerCase();
          break;
        case 'phone':
          aVal = a.phone ?? '';
          bVal = b.phone ?? '';
          break;
        case 'companyName':
          aVal = (a.companyName ?? '').toLowerCase();
          bVal = (b.companyName ?? '').toLowerCase();
          break;
        case 'status':
          aVal = (a.status ?? '').toLowerCase();
          bVal = (b.status ?? '').toLowerCase();
          break;
        case 'source':
          aVal = (a.leadSource ?? a.source ?? '').toLowerCase();
          bVal = (b.leadSource ?? b.source ?? '').toLowerCase();
          break;
        case 'assignedUserId':
          aVal = (a.assignedUserId ?? '').toLowerCase();
          bVal = (b.assignedUserId ?? '').toLowerCase();
          break;
        case 'createdAt':
          aVal = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          bVal = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          break;
        case 'updatedAt': {
          const aRec = a as unknown as Record<string, unknown>;
          const bRec = b as unknown as Record<string, unknown>;
          aVal = aRec.updatedAt ? new Date(aRec.updatedAt as string).getTime() : 0;
          bVal = bRec.updatedAt ? new Date(bRec.updatedAt as string).getTime() : 0;
          break;
        }
        default:
          return 0;
      }

      if (aVal === bVal) return 0;
      if (aVal == null || aVal === '') return 1;
      if (bVal == null || bVal === '') return -1;

      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });

      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [leads, sort]);

  /** Resolve label for a column id */
  const getColumnLabel = (colId: string): string => {
    const def = registry.find((r) => r.id === colId);
    return def?.label ?? colId;
  };

  // Handle case where no columns are visible
  if (visibleColumns.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <p className="text-[13px] text-[#5A6B85] dark:text-slate-400">
            No columns are currently visible.
          </p>
          <p className="text-[12px] text-[#5A6B85]/70 dark:text-slate-500">
            Open Manage Columns to choose the columns you want to display.
          </p>
        </div>
      </div>
    );
  }

  /** Render a cell value for a given column id and lead */
  const renderCell = (colId: string, lead: Lead): React.ReactNode => {
    switch (colId) {
      case 'firstName':
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
              {getInitials(lead)}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate leading-tight group-hover:text-[#2563EB] transition-colors">
                {getLeadName(lead)}
              </p>
            </div>
          </div>
        );
      case 'lastName':
        return (
          <p className="text-[13px] text-[#0F172A] dark:text-slate-200 truncate">
            {lead.lastName ?? '—'}
          </p>
        );
      case 'email':
        return (
          <p className="text-[13px] text-[#0F172A] dark:text-slate-200 truncate">
            {lead.email ?? '—'}
          </p>
        );
      case 'phone':
        return (
          <p className="text-[13px] text-[#0F172A] dark:text-slate-200 truncate">
            {lead.phone ?? '—'}
          </p>
        );
      case 'companyName':
        return (
          <p className="text-[13px] text-[#0F172A] dark:text-slate-200 truncate">
            {lead.companyName ?? '—'}
          </p>
        );
      case 'status':
        return <StatusBadge label={lead.status} variant={getStatusVariant(lead.status)} />;
      case 'source':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {lead.leadSource ?? '—'}
          </p>
        );
      case 'assignedUserId':
        return (
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-slate-300">
              {getOwnerInitials(lead.assignedUserId)}
            </div>
            <span className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate max-w-[60px] hidden xl:inline">
              {getOwnerName(lead.assignedUserId).split(' ')[0]}
            </span>
          </div>
        );
      case 'productInterest':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {((lead as unknown as Record<string, unknown>).productInterest as string) ?? '—'}
          </p>
        );
      case 'address':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {lead.city ?? '—'}
          </p>
        );
      case 'createdAt':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </p>
        );
      case 'accountId':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {((lead as unknown as Record<string, unknown>).accountId as string) ?? '—'}
          </p>
        );
      case 'emailAndPhone':
        return (
          <div className="min-w-0">
            <p className="text-[12px] text-[#0F172A] dark:text-slate-200 truncate">{lead.email ?? '—'}</p>
            {lead.phone && <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate">{lead.phone}</p>}
          </div>
        );
      case 'description':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {(lead as unknown as Record<string, unknown>).description as string ?? '—'}
          </p>
        );
      case 'website':
        return (
          <p className="text-[12px] text-[#2563EB] dark:text-blue-400 truncate">
            {(lead as unknown as Record<string, unknown>).website as string ?? '—'}
          </p>
        );
      case 'updatedAt':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {(lead as unknown as Record<string, unknown>).updatedAt
              ? new Date((lead as unknown as Record<string, unknown>).updatedAt as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—'}
          </p>
        );
      case 'primaryAddressCityState':
        return (
          <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
            {lead.city ?? '—'}
          </p>
        );
      default:
        return <span className="text-[12px] text-[#5A6B85]">—</span>;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl overflow-hidden overflow-x-auto">
      {/* Table header — fixed, no drag */}
      <div
        className={cn(
          'inline-flex items-center min-w-full border-b border-[#E4E9F0] dark:border-slate-700 bg-[#F6F8FB] dark:bg-slate-800/60 sticky top-0 z-10',
          'text-[11.5px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400',
          dense ? 'h-10 px-3' : 'h-11 px-3',
        )}
      >
        {/* Select-all checkbox */}
        <label className="flex items-center justify-center w-10 shrink-0">
          <input
            type="checkbox"
            checked={selectedIds.length === leads.length && leads.length > 0}
            onChange={onSelectAll}
            className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer"
            aria-label="Select all leads"
          />
        </label>

        {/* Column headers with sort icons */}
        {visibleColumns.map((col) => {
          const responsiveClass = getResponsiveColumnClass(col.id, visibleColumns, registry);
          const isSortable = SORTABLE_COLUMNS.has(col.id);
          const sortDir = getSortDirection(col.id);
          const sortLabel = isSortable
            ? sortDir === 'asc'
              ? `Sort by ${getColumnLabel(col.id)} descending`
              : sortDir === 'desc'
              ? `Clear sort on ${getColumnLabel(col.id)}`
              : `Sort by ${getColumnLabel(col.id)} ascending`
            : undefined;

          return (
            <button
              key={col.id}
              type="button"
              onClick={() => handleHeaderClick(col.id)}
              disabled={!isSortable}
              title={sortLabel}
              aria-label={sortLabel}
              aria-sort={
                sortDir === 'asc' ? 'ascending' :
                sortDir === 'desc' ? 'descending' : 'none'
              }
              className={cn(
                'px-3 truncate flex-1 select-none whitespace-nowrap inline-flex items-center',
                responsiveClass,
                isSortable
                  ? 'cursor-pointer hover:text-[#3C4858] dark:hover:text-slate-300'
                  : 'cursor-default',
                // Active sort column text color
                sortDir != null && 'text-[#3C4858] dark:text-slate-300',
              )}
              style={{ minWidth: 140 }}
            >
              <span className="truncate">{getColumnLabel(col.id)}</span>
              {isSortable && <SortIndicator direction={sortDir} />}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="divide-y divide-[#E4E9F0] dark:divide-slate-700">
        {sortedLeads.length === 0 && (
          <div className="flex items-center justify-center py-16 text-[13px] text-[#5A6B85] dark:text-slate-400">
            No leads found. Adjust your filters or create a new lead.
          </div>
        )}
        {sortedLeads.map((lead) => {
          const isSelected = selectedIds.includes(lead.id);

          return (
            <div
              key={lead.id}
              onClick={() => onRowClick(lead)}
              className={cn(
                'inline-flex items-center min-w-full cursor-pointer transition-colors group',
                viewMode === 'wrap'
                  ? (dense ? 'min-h-[44px] px-3 py-2' : 'min-h-[52px] px-3 py-2')
                  : (dense ? 'h-[44px] px-3' : 'h-[52px] px-3'),
                isSelected
                  ? 'bg-blue-50/60 dark:bg-blue-500/5'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
              )}
            >
              {/* Checkbox */}
              <label
                className="flex items-center justify-center w-10 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(lead.id)}
                  className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer"
                  aria-label={`Select ${getLeadName(lead)}`}
                />
              </label>

              {/* Dynamic columns */}
              {visibleColumns.map((col) => {
                const responsiveClass = getResponsiveColumnClass(col.id, visibleColumns, registry);
                return (
                  <div
                    key={col.id}
                    style={{ minWidth: 140 }}
                    className={cn(
                      'px-3 flex-1',
                      responsiveClass,
                      viewMode === 'clip'
                        ? '[&_p]:truncate [&_span]:truncate'
                        : '[&_p]:whitespace-normal [&_p]:break-words [&_span]:whitespace-normal [&_span]:break-words',
                    )}
                  >
                    {renderCell(col.id, lead)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 bg-[#F6F8FB] dark:bg-slate-800/60">
        <span className="text-[12px] text-[#5A6B85] dark:text-slate-400">
          Total records <strong className="font-semibold text-[#0F172A] dark:text-white">{totalRecords}</strong>
        </span>
        <div className="flex items-center gap-2 text-[12px] text-[#5A6B85]">
          <span>
            {totalRecords === 0
              ? '0 records'
              : `${(currentPage - 1) * pageSize + 1} to ${Math.min(currentPage * pageSize, totalRecords)}`}
          </span>
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className={cn(
              'p-1 transition-colors',
              currentPage <= 1
                ? 'text-[#5A6B85]/40 dark:text-slate-600 cursor-not-allowed'
                : 'hover:text-[#0F172A] dark:hover:text-white',
            )}
            aria-label="Previous page"
          >
            &lt;
          </button>
          <span className="text-[11px] tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className={cn(
              'p-1 transition-colors',
              currentPage >= totalPages
                ? 'text-[#5A6B85]/40 dark:text-slate-600 cursor-not-allowed'
                : 'hover:text-[#0F172A] dark:hover:text-white',
            )}
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  );
}
