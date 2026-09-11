'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useColumnPreferences } from '@/shared/hooks/use-column-preferences';
import { useTablePreferences } from '@/shared/hooks/use-table-preferences';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { ModuleWorkspace, ViewType, DealPanel } from '@/shared/components/crm';
import { ModuleErrorBoundary } from '@/shared/components/error-boundary';
import { useDealsPage } from '../hooks/use-deals-page';
import { DEALS_MODULE_CONFIG } from '../deals.config';
import { DEALS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { DealsDataGrid } from './deals-data-grid';
import { DealsGridView } from './deals-grid-view';
import { ManageColumnsDrawer } from '@/shared/components/manage-columns-drawer';
import DealFilters from '../ui/deal-filters';
import { DealFormSheet } from './deal-form';
import type { Deal, Task } from '@/store/types';
import type { ColumnConfigItem } from '@leadcrm/shared';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { toast } from 'sonner';
import { formatCurrency, getTenantCurrency } from '@/shared/utils/currency';
import { Briefcase } from 'lucide-react';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';

export default function DealsPage() {
  const { user, tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);
  const { tasks, users, organizations, updateDeal, moveDealStage, deleteDeal, addDeal, addTask, updateTask, isBillingModuleEnabled } = useData();
  const canCreate = useHasPermission('deals.create');
  const canEdit   = useHasPermission('deals.edit');
  const canDelete = useHasPermission('deals.delete');

  // ── Create Form State ─────────────────────────────────────────────────
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);

  const {
    deals, totalCount, filters, setFilters,
    selectedDeal, setSelectedDeal,
    stageNameMap, stageProbabilityMap, pipelineNameMap,
    forecastTotal, pipelines,
  } = useDealsPage();

  // ── Column Preferences ────────────────────────────────────────────────
  const {
    effectiveColumns,
    isLoading: isColumnsLoading,
    saveColumns,
    resetColumns,
  } = useColumnPreferences('deals');

  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const [dealSelectedIds, setDealSelectedIds] = useState<Set<string>>(new Set());

  // ── Table Preferences (pageSize, viewMode, sort) ──────────────────────
  const {
    pageSize,
    viewMode,
    sort,
    setPageSize,
    setViewMode,
    setSort,
    persistFilters,
  } = useTablePreferences('deals');

  // ── Search state with 300ms debounce ────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);

  // ── Persist filter changes (fire-and-forget) ──────────────────────────
  useEffect(() => {
    // Convert DealPageFilters to FilterCondition-like array for server persistence
    const conditions: { field: string; operator: string; value: unknown }[] = [];
    if (filters.stages.length > 0) {
      conditions.push({ field: 'stageId', operator: 'in', value: filters.stages });
    }
    if (filters.priorities.length > 0) {
      conditions.push({ field: 'priority', operator: 'in', value: filters.priorities });
    }
    if (filters.pipelines.length > 0) {
      conditions.push({ field: 'pipelineId', operator: 'in', value: filters.pipelines });
    }
    persistFilters(conditions);
  }, [filters, persistFilters]);

  /** Visible columns sorted by order — drives table rendering */
  const visibleColumns = useMemo((): ColumnConfigItem[] => {
    if (effectiveColumns.length === 0) {
      return DEALS_COLUMN_REGISTRY
        .filter((col) => col.defaultVisible)
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((col) => ({ id: col.id, visible: true, order: col.defaultOrder }));
    }
    return [...effectiveColumns]
      .filter((col) => col.visible)
      .sort((a, b) => a.order - b.order);
  }, [effectiveColumns]);

  // ── View state ────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ViewType>('table');

  // ── Apply debounced search on top of hook-filtered deals ──────────────
  const searchFilteredDeals = useMemo(() => {
    if (!debouncedSearch) return deals;
    const term = debouncedSearch.toLowerCase();
    return deals.filter(
      (d) =>
        d.title.toLowerCase().includes(term) ||
        (d.companyName ?? '').toLowerCase().includes(term) ||
        (d.contactPerson ?? '').toLowerCase().includes(term),
    );
  }, [deals, debouncedSearch]);

  const {
    currentPage,
    pageSize: paginationPageSize,
    totalPages,
    totalItems,
    goToPage,
    setPageSize: setPaginationPageSize,
    paginateItems,
  } = usePagination({
    totalItems: searchFilteredDeals.length,
    initialPageSize: 25,
    pageSizeOptions: [10, 20, 25, 30, 40, 50],
    resetDeps: [filters, debouncedSearch, sort],
  });

  const paginatedDeals = useMemo(() => paginateItems(searchFilteredDeals), [paginateItems, searchFilteredDeals]);

  // ── Lookup helpers ──────────────────────────────────────────────────────
  const getAssignedUserName = (userId?: string): string => {
    if (!userId) return '—';
    const u = users.find((usr) => usr.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : '—';
  };

  const getAccountName = (accountId?: string): string => {
    if (!accountId) return '—';
    const org = organizations.find((o) => o.id === accountId);
    return org?.name ?? '—';
  };

  const selectedPipeline = selectedDeal
    ? (pipelines.find(p => p.id === selectedDeal.pipelineId) ?? pipelines[0])
    : null;

  const handleNavigate = (path: string) => {
    void path;
  };

  return (
    <>
      <ModuleWorkspace
        moduleId="deals"
        title="All Deals"
        moduleConfig={DEALS_MODULE_CONFIG}
        description={`${totalCount} ${totalCount === 1 ? 'deal' : 'deals'} total`}
        primaryActionLabel="Add Deal"
        onPrimaryAction={() => setIsCreateFormOpen(true)}
        canCreate={canCreate}
        availableViews={['table', 'list', 'grid', 'tile', 'kanban']}
        activeView={activeView}
        onViewChange={setActiveView}

        sortableFields={DEALS_COLUMN_REGISTRY.map((col) => ({ id: col.id, label: col.label }))}
        sort={sort}
        onSortChange={setSort}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        totalRecords={searchFilteredDeals.length}
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        searchPlaceholder="Search deals..."
        onRefresh={() => toast.success('Refreshed')}
        currentPage={currentPage}
        paginationTotalRecords={totalItems}
        onPageChange={goToPage}
        onManageColumns={() => setIsManageColumnsOpen(true)}
        kpiCards={[
          { label: 'TOTAL DEALS', value: String(totalCount) },
          { label: 'WEIGHTED FORECAST', value: formatCurrency(forecastTotal, tenantCurrency) },
        ]}
      >
        {/* ── Filters (shared across all views) ──────────────────────── */}
        <DealFilters filters={filters} onChange={setFilters} pipelines={pipelines} />

        {/* ── Table View (DataGrid) ──────────────────────────────────── */}
        {activeView === 'table' && (
          <div className="space-y-4">
            {searchFilteredDeals.length === 0 && (
              <ActionableEmptyState
                icon={Briefcase}
                title={debouncedSearch ? 'No deals match your search' : 'No deals yet'}
                description={
                  debouncedSearch
                    ? 'Try a different search term or clear your filters.'
                    : 'Create your first deal to start tracking opportunities in your pipeline.'
                }
                actionLabel={!debouncedSearch && canCreate ? 'Add Deal' : undefined}
                onAction={!debouncedSearch && canCreate ? () => setIsCreateFormOpen(true) : undefined}
              />
            )}
            {searchFilteredDeals.length > 0 && (
            <ModuleErrorBoundary fallbackLabel="Deals Table">
            <DealsDataGrid
              deals={paginatedDeals}
              totalRecords={totalItems}
              effectiveColumns={effectiveColumns}
              sort={sort}
              onSortChange={setSort}
              onRowClick={setSelectedDeal}
              selectedIds={dealSelectedIds}
              onSelectionChange={setDealSelectedIds}
              stageNameMap={stageNameMap}
              pipelineNameMap={pipelineNameMap}
              getAssignedUserName={getAssignedUserName}
              getAccountName={getAccountName}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={(deal) => setSelectedDeal(deal)}
              onDelete={async (deal) => {
                try {
                  await deleteDeal(deal.id);
                  toast.success('Deal deleted successfully');
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Failed to delete deal');
                }
              }}
              onManageColumns={() => setIsManageColumnsOpen(true)}
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
              currencyConfig={tenantCurrency}
              onColumnReorder={async (columns) => {
                try {
                  await saveColumns(columns);
                } catch {
                  toast.error('Failed to save column order. Reverted to previous layout.');
                }
              }}
            />
            </ModuleErrorBoundary>
            )}

            <div className="mt-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={paginationPageSize}
                totalItems={totalItems}
                pageSizeOptions={[10, 20, 25, 30, 40, 50]}
                onPageChange={goToPage}
                onPageSizeChange={setPaginationPageSize}
              />
            </div>
          </div>
        )}

        {/* ── Kanban View (placeholder — kanban board lives in pipeline module) */}
        {activeView === 'kanban' && (
          <div className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-8 text-center">
            <p className="text-[13px] text-[#5A6B85] dark:text-slate-400">
              Kanban view — use the Pipeline board for drag-and-drop stage management.
            </p>
          </div>
        )}

        {/* ── List / Grid / Tile views ────────────────────────────── */}
        {activeView === 'list' && (
          <div className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-8 text-center">
            <p className="text-[13px] text-[#5A6B85] dark:text-slate-400">
              List view coming soon.
            </p>
          </div>
        )}
        {(activeView === 'grid' || activeView === 'tile') && (
          <DealsGridView
            deals={paginatedDeals}
            onEdit={(deal) => setEditingDeal(deal)}
            onDelete={async (dealId) => {
              try {
                await deleteDeal(dealId);
                toast.success('Deal deleted');
              } catch (err: unknown) {
                toast.error(err instanceof Error ? err.message : 'Failed to delete deal');
              }
            }}
          />
        )}
      </ModuleWorkspace>

      {/* ── Manage Columns Drawer ───────────────────────────────── */}
      <ManageColumnsDrawer
        module="deals"
        registry={DEALS_COLUMN_REGISTRY}
        effectiveColumns={effectiveColumns}
        isOpen={isManageColumnsOpen}
        onClose={() => setIsManageColumnsOpen(false)}
        onSave={saveColumns}
        onReset={resetColumns}
      />

      {/* ── Deal Form (Create/Edit) ──────────────────────────── */}
      <DealFormSheet
        isOpen={isCreateFormOpen || !!editingDeal}
        onClose={() => { setIsCreateFormOpen(false); setEditingDeal(null); }}
        mode={editingDeal ? 'edit' : 'create'}
        initialData={editingDeal ?? undefined}
        onSubmit={async (data) => {
          try {
            if (editingDeal) {
              await updateDeal(editingDeal.id, data as any);
              toast.success('Deal updated');
              setEditingDeal(null);
            } else {
              await addDeal(data as any);
              setIsCreateFormOpen(false);
              toast.success('Deal created successfully');
            }
          } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to save deal');
          }
        }}
      />

      {/* ── Slide-Over Deal Panel ─────────────────────────────────── */}
      <DealPanel
        open={!!selectedDeal}
        onOpenChange={(open) => !open && setSelectedDeal(null)}
        deal={selectedDeal}
        onEdit={(d) => { setEditingDeal(d); }}
      />
    </>
  );
}
