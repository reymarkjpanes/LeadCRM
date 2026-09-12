'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ModuleWorkspace, ViewType, AccountPanel, StatusBadge } from '@/shared/components/crm';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useColumnPreferences } from '@/shared/hooks/use-column-preferences';
import { useAccounts } from '../hooks/use-accounts';
import { useData } from '@/store/DataContext';
import { useFilterUrlSync } from '@/shared/hooks/use-filter-url-sync';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useTablePreferences } from '@/shared/hooks/use-table-preferences';
import { ManageColumnsDrawer } from '@/shared/components/manage-columns-drawer';
import { ACCOUNTS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { ACCOUNTS_MODULE_CONFIG } from '../accounts.config';
import { AccountsDataGrid } from './accounts-data-grid';
import AccountForm from '../ui/account-form';
import { useRouter } from 'next/navigation';
// @deprecated — ImportAccountsDrawer replaced by full-page import at /crm/accounts/import
// import { ImportAccountsDrawer } from './import-accounts-drawer';
import { SideSheet } from '@/shared/components/side-sheet';
import { ColumnsPopover } from '@/shared/components/data-grid';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';
import { PageSizeSelect } from '@/shared/components/page-size-select';
import type { Account } from '../types/account.types';
import type { ColumnConfigItem } from '@leadcrm/shared';

// ── Accounts Page ─────────────────────────────────────────────────────────────

export default function AccountsPage(): React.ReactElement {
  const router = useRouter();
  const canCreate = useHasPermission('accounts.create');
  const canEdit = useHasPermission('accounts.edit');
  const canDelete = useHasPermission('accounts.delete');

  const {
    accounts,
    totalCount,
    filters,
    setFilters,
    isFormOpen,
    editTarget,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
  } = useAccounts();

  const { deals, users } = useData();
  const { getParam, getArrayParam, updateParams } = useFilterUrlSync('accounts');

  // ── Column Preferences ────────────────────────────────────────────────
  const {
    effectiveColumns,
    isLoading: isColumnsLoading,
    saveColumns,
    resetColumns,
  } = useColumnPreferences('accounts');

  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const manageColumnsButtonRef = useRef<HTMLButtonElement>(null);

  // ── Table Preferences (pageSize, viewMode, sort) ──────────────────────
  const {
    pageSize,
    viewMode,
    sort,
    setPageSize,
    setViewMode,
    setSort,
    persistFilters,
  } = useTablePreferences('accounts');

  // ── State (Synced with URL) ──────────────────────────────────────────
  const [activeView, setActiveView] = useState<ViewType>(() => (getParam('view') as ViewType) || 'list');
  const [activeTab, setActiveTab] = useState(() => getParam('tab') || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => getParam('search'));
  const [filterSearchTerm, setFilterSearchTerm] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [drawerTab, setDrawerTab] = useState('overview');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accountSelectedIds, setAccountSelectedIds] = useState<Set<string>>(new Set());

  // Multi-criteria filter state
  const [selectedSystemFilters, setSelectedSystemFilters] = useState<string[]>(() => getArrayParam('system'));
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(() => getArrayParam('industries'));
  const [selectedTypes, setSelectedTypes] = useState<string[]>(() => getArrayParam('types'));
  const [selectedOwners, setSelectedOwners] = useState<string[]>(() => getArrayParam('owners'));
  const [selectedRelated, setSelectedRelated] = useState<string[]>(() => getArrayParam('related'));

  const debouncedSearch = useDebounce(searchTerm, 300);

  // Sync to URL
  useEffect(() => {
    updateParams({
      tab: activeTab !== 'all' ? activeTab : null,
      search: debouncedSearch || null,
      view: activeView !== 'list' ? activeView : null,
      system: selectedSystemFilters,
      industries: selectedIndustries,
      types: selectedTypes,
      owners: selectedOwners,
      related: selectedRelated,
    });
  }, [activeTab, debouncedSearch, activeView, selectedSystemFilters, selectedIndustries, selectedTypes, selectedOwners, selectedRelated, updateParams]);

  // ── Persist filter selections (fire-and-forget) ────────────────────────
  useEffect(() => {
    const conditions: { field: string; operator: string; value: unknown }[] = [];
    if (selectedIndustries.length > 0) {
      conditions.push({ field: 'industry', operator: 'in', value: selectedIndustries });
    }
    if (selectedTypes.length > 0) {
      conditions.push({ field: 'type', operator: 'in', value: selectedTypes });
    }
    if (selectedOwners.length > 0) {
      conditions.push({ field: 'assignedUserId', operator: 'in', value: selectedOwners });
    }
    if (selectedRelated.length > 0) {
      conditions.push({ field: 'related', operator: 'in', value: selectedRelated });
    }
    if (selectedSystemFilters.length > 0) {
      conditions.push({ field: 'system', operator: 'in', value: selectedSystemFilters });
    }
    persistFilters(conditions);
  }, [selectedIndustries, selectedTypes, selectedOwners, selectedRelated, selectedSystemFilters, persistFilters]);

  // ── Filtered list ────────────────────────────────────────────────────
  const filteredAccounts = useMemo(() => {
    let result = accounts;

    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(term) ||
          (a.industry ?? '').toLowerCase().includes(term) ||
          (a.city ?? '').toLowerCase().includes(term),
      );
    }

    if (selectedIndustries.length > 0) {
      result = result.filter((a) => selectedIndustries.includes(a.industry ?? ''));
    }

    if (selectedTypes.length > 0) {
      result = result.filter((a) => selectedTypes.includes(a.size ?? ''));
    }

    if (selectedOwners.length > 0) {
      result = result.filter((a) => selectedOwners.includes(a.assignedUserId ?? ''));
    }

    if (selectedRelated.includes('has_deals')) {
      result = result.filter((a) => deals.some((d) => d.organizationId === a.id && !d.isArchived));
    }

    return result;
  }, [accounts, debouncedSearch, selectedIndustries, selectedTypes, selectedOwners, selectedRelated, deals]);

  // ── Pagination ───────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter/search/pageSize/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedIndustries, selectedTypes, selectedOwners, selectedRelated, pageSize, sort]);

  const paginatedAccounts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAccounts.slice(start, start + pageSize);
  }, [filteredAccounts, currentPage, pageSize]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getOwnerName = (userId?: string): string => {
    if (!userId) return '—';
    const u = users.find((usr) => usr.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };

  const getAccountDeals = (accountId: string): number => {
    return deals.filter((d) => d.organizationId === accountId && !d.isArchived).length;
  };

  const getAccountValue = (accountId: string): number => {
    return deals
      .filter((d) => d.organizationId === accountId && !d.isArchived)
      .reduce((sum, d) => sum + (d.value ?? 0), 0);
  };

  const getStatusVariant = (type?: string): 'success' | 'info' | 'purple' | 'danger' | 'neutral' => {
    if (type === 'Customer' || type === 'Active') return 'success';
    if (type === 'Prospect') return 'info';
    if (type === 'Partner') return 'purple';
    if (type === 'Churned') return 'danger';
    return 'neutral';
  };

  // ── Filter groups ────────────────────────────────────────────────────
  const distinctIndustries = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => { if (a.industry) set.add(a.industry); });
    return Array.from(set);
  }, [accounts]);

  const distinctSizes = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => {
      if (a.size) set.add(a.size);
    });
    return Array.from(set);
  }, [accounts]);

  const filterGroups = useMemo(() => [
    {
      id: 'system',
      label: 'System Defined Filters',
      isExpanded: true,
      items: [
        { id: 'touched', label: 'Updated Records', count: accounts.length, isChecked: selectedSystemFilters.includes('touched') },
        { id: 'untouched', label: 'Never Updated', count: 0, isChecked: selectedSystemFilters.includes('untouched') },
      ],
    },
    {
      id: 'fields',
      label: 'Filter By Fields',
      isExpanded: true,
      items: [
        ...distinctIndustries.map((ind) => ({
          id: `industry:${ind}`,
          label: `Industry: ${ind}`,
          count: accounts.filter((a) => a.industry === ind).length,
          isChecked: selectedIndustries.includes(ind),
        })),
        ...distinctSizes.map((sz) => ({
          id: `size:${sz}`,
          label: `Size: ${sz}`,
          count: accounts.filter((a) => a.size === sz).length,
          isChecked: selectedTypes.includes(sz),
        })),
        ...users.slice(0, 5).map((u) => ({
          id: `owner:${u.id}`,
          label: `Owner: ${u.firstName} ${u.lastName}`,
          count: accounts.filter((a) => a.assignedUserId === u.id).length,
          isChecked: selectedOwners.includes(u.id),
        })),
      ],
    },
    {
      id: 'related',
      label: 'Filter By Related Modules',
      isExpanded: true,
      items: [
        { id: 'has_deals', label: 'Accounts with Deals', count: accounts.filter((a) => deals.some((d) => d.organizationId === a.id && !d.isArchived)).length, isChecked: selectedRelated.includes('has_deals') },
      ],
    },
  ], [accounts, distinctIndustries, distinctSizes, selectedSystemFilters, selectedIndustries, selectedTypes, users, selectedOwners, selectedRelated, deals]);

  const handleFilterToggle = useCallback((groupId: string, itemId: string) => {
    if (groupId === 'system') {
      setSelectedSystemFilters((prev) =>
        prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
      );
    } else if (groupId === 'fields') {
      if (itemId.startsWith('industry:')) {
        const ind = itemId.replace('industry:', '');
        setSelectedIndustries((prev) =>
          prev.includes(ind) ? prev.filter((x) => x !== ind) : [...prev, ind],
        );
      } else if (itemId.startsWith('type:')) {
        const typ = itemId.replace('type:', '');
        setSelectedTypes((prev) =>
          prev.includes(typ) ? prev.filter((x) => x !== typ) : [...prev, typ],
        );
      } else if (itemId.startsWith('owner:')) {
        const ownerId = itemId.replace('owner:', '');
        setSelectedOwners((prev) =>
          prev.includes(ownerId) ? prev.filter((x) => x !== ownerId) : [...prev, ownerId],
        );
      }
    } else if (groupId === 'related') {
      setSelectedRelated((prev) =>
        prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
      );
    }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleRowClick = useCallback((account: Account) => {
    setSelectedAccount(account);
    setDrawerTab('overview');
  }, []);

  const handleSubmit = (data: any) => {
    if (editTarget) {
      handleUpdate(editTarget.id, data);
    } else {
      handleCreate(data);
    }
  };

  return (
    <>
      <ModuleWorkspace
        moduleId="accounts"
        title="Accounts"
        moduleConfig={ACCOUNTS_MODULE_CONFIG}
        primaryActionLabel="Add Account"
        onPrimaryAction={handleOpenCreate}
        onImport={() => router.push('/crm/accounts/import')}
        canCreate={canCreate}
        availableViews={['table']}
        activeView={'table' as ViewType}
        onViewChange={setActiveView}

        pageSize={pageSize}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        savedTabs={[
          { id: 'all', label: 'All Accounts' },
          { id: 'my', label: 'My Accounts' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        filterGroups={filterGroups}
        onFilterToggle={handleFilterToggle}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        filterSearchTerm={filterSearchTerm}
        onFilterSearch={setFilterSearchTerm}
        totalRecords={filteredAccounts.length}
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        searchPlaceholder="Search accounts..."
        onRefresh={() => toast.success('Refreshed')}
        onManageColumns={() => setIsManageColumnsOpen(true)}
      >
        {/* List View — DataGrid */}
        {(activeView === 'list' || activeView === 'table') && (
          <>
            {filteredAccounts.length === 0 && (
              <ActionableEmptyState
                icon={Building2}
                title={debouncedSearch ? 'No accounts match your search' : 'No accounts yet'}
                description={
                  debouncedSearch
                    ? 'Try a different search term or clear your filters.'
                    : 'Add your first account to start tracking your companies and organisations.'
                }
                actionLabel={!debouncedSearch && canCreate ? 'Add Account' : undefined}
                onAction={!debouncedSearch && canCreate ? handleOpenCreate : undefined}
              />
            )}
            {filteredAccounts.length > 0 && (
          <AccountsDataGrid
            accounts={paginatedAccounts}
            totalRecords={filteredAccounts.length}
            effectiveColumns={effectiveColumns}
            onRowClick={handleRowClick}
            selectedIds={accountSelectedIds}
            onSelectionChange={setAccountSelectedIds}
            getOwnerName={getOwnerName}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={handleOpenEdit}
            onDelete={(account) => handleDelete(account.id)}
            onHideColumn={async (columnId) => {
              const updated = effectiveColumns.map((col) =>
                col.id === columnId ? { ...col, visible: false } : col,
              );
              try {
                await saveColumns(updated);
              } catch {
                toast.error('Failed to hide column. Reverted.');
              }
            }}
            viewMode={viewMode}
          />
            )}
          </>
        )}

        {/* ── Bottom Pagination + Per Page ─────────────────────── */}
        {(activeView === 'list' || activeView === 'table') && filteredAccounts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 mt-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-2">
              <label htmlFor="accounts-page-size" className="text-xs text-slate-500 dark:text-slate-400">Per page</label>
              <PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setCurrentPage(1); }} />
              <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{filteredAccounts.length} total records</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Page {currentPage} of {Math.ceil(filteredAccounts.length / pageSize) || 1}</span>
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors', currentPage <= 1 ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Previous page">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setCurrentPage(Math.min(Math.ceil(filteredAccounts.length / pageSize), currentPage + 1))} disabled={currentPage >= Math.ceil(filteredAccounts.length / pageSize)} className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors', currentPage >= Math.ceil(filteredAccounts.length / pageSize) ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Next page">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Tile View */}
        {activeView === 'tile' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredAccounts.map((account) => (
              <div
                key={account.id}
                onClick={() => handleRowClick(account)}
                className="bg-white dark:bg-slate-800/60 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-[#2563EB]/30 transition-all"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-[11px] shrink-0">
                    {getInitials(account.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate">
                      {account.name}
                    </p>
                    <p className="text-[11.5px] text-[#5A6B85] dark:text-slate-400 truncate">
                      {account.industry ?? '—'} · {account.city ?? ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-[#E4E9F0] dark:border-slate-700">
                  <span className="text-[12px] text-[#5A6B85]">
                    {getAccountDeals(account.id)} deals
                  </span>
                  <span className="text-[13px] font-semibold text-[#0F172A] dark:text-white tabular-nums">
                    {formatCurrency(getAccountValue(account.id))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Grid View */}
        {activeView === 'grid' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {filteredAccounts.map((account) => (
              <div
                key={account.id}
                onClick={() => handleRowClick(account)}
                className="bg-white dark:bg-slate-800/60 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-md transition-all flex items-center gap-2.5"
              >
                <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                  {getInitials(account.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[#0F172A] dark:text-white truncate">
                    {account.name}
                  </p>
                  <p className="text-[10.5px] text-[#5A6B85] dark:text-slate-400 truncate">
                    {account.industry ?? '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ModuleWorkspace>

      {/* ── Slide-Over Account Panel ──────────────────────────────── */}
      <AccountPanel
        open={!!selectedAccount}
        onOpenChange={(open) => !open && setSelectedAccount(null)}
        account={selectedAccount}
        onEdit={(acc) => handleOpenEdit(acc)}
      />

      {/* Form Sheet */}
      <SideSheet
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        title={editTarget ? 'Edit Account' : 'New Account'}
      >
        <AccountForm
          initial={editTarget}
          onSubmit={handleSubmit}
          onCancel={handleCloseForm}
        />
      </SideSheet>

      {/* ── Manage Columns Drawer ───────────────────────────────── */}
      <ManageColumnsDrawer
        isOpen={isManageColumnsOpen}
        onClose={() => setIsManageColumnsOpen(false)}
        module="accounts"
        registry={ACCOUNTS_COLUMN_REGISTRY}
        effectiveColumns={effectiveColumns}
        onSave={saveColumns}
        onReset={resetColumns}
        triggerRef={manageColumnsButtonRef}
      />

      {/* ── Import Accounts — now a full-page experience at /crm/accounts/import ─── */}
    </>
  );
}

// ── Currency formatter ─────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `$${value.toLocaleString()}`;
}
