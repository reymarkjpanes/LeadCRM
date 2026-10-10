'use client';
import { PageHeader } from '@/shared/components/ui/page-header';
import { CreateButton } from '@/shared/components/ui/button';

import { SelectedRowsBar } from '@/shared/components/crm/selected-rows-bar';


import React, { useState, useCallback, useRef, useEffect, useMemo, ReactNode } from 'react';
import {
  List, LayoutGrid, Table2, Columns3, Grid3X3,
  TrendingUp,
  Settings2, ChevronDown, ChevronLeft, ChevronRight, X, Upload,
  ListOrdered, Eye, Check, FileUp, UserPlus, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import type { SortPreference, ViewMode } from '@/shared/hooks/use-table-preferences';
import type { ModuleConfig, ViewType as SharedViewType, ColumnConfigItem } from '@leadcrm/shared';
import { useViewTypePreference } from '@/shared/hooks/use-view-type-preference';
import { VIEW_OPTIONS as VIEW_RENDERERS } from './view-registry';
import { validateModuleConfig } from './validate-module-config';
import { ModuleFilterRail, type FilterGroup } from './module-filter-rail';
import { ManageColumnsButton } from './manage-columns-button';
import { ModuleSearchInput } from './module-search-input';
import { FilterButton } from './filter-button';
import { RefreshButton } from './refresh-button';
import { TableLoadingState } from './table-loading-state';
import { PaginationControls } from './pagination-controls';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViewType = 'list' | 'tile' | 'table' | 'kanban' | 'grid' | 'forecast';

export interface SortableField {
  id: string;
  label: string;
}

interface ViewOption {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface SavedViewTab {
  id: string;
  label: string;
  isActive?: boolean;
}

interface KpiCard {
  label: string;
  value: string;
  subtitle?: string;
}

export interface ModuleWorkspaceProps {
  /** Module ID (informational — not used internally, use for debugging) */
  moduleId: string;
  /** Module title e.g. "Leads" */
  title: string;
  /** One-line module description */
  description?: string;
  /** Primary action button label e.g. "Create Lead" */
  primaryActionLabel: string;
  /** Primary action callback */
  onPrimaryAction: () => void;
  /** Import action callback */
  onImport?: () => void;
  /** Can user create (RBAC) */
  canCreate?: boolean;
  /** Available view types for this module */
  availableViews: ViewType[];
  /** Currently active view */
  activeView: ViewType;
  /** View change handler */
  onViewChange: (view: ViewType) => void;
  /**
   * Optional Module_Config for the new Data_View_System.
   * When provided, enables: validation on mount, active view resolution from VIEW_OPTIONS,
   * view switcher wired to useViewTypePreference, and sort controls from sortableFields.
   */
  moduleConfig?: ModuleConfig;
  /** Data rows for the active view renderer (used when moduleConfig is provided) */
  viewData?: Record<string, unknown>[];
  /** Effective column config (used when moduleConfig is provided with view renderer) */
  viewColumns?: ColumnConfigItem[];
  /** Row click handler for view renderers */
  onRowClick?: (recordId: string) => void;
  /** Row selection handler for view renderers */
  onRowSelect?: (recordId: string, selected: boolean) => void;
  /** Currently selected row IDs */
  selectedIds?: Set<string>;
  /** Whether data is loading */
  isDataLoading?: boolean;
  /** Show the shared table loading card in place of the content. */
  loading?: boolean;
  loadingLabel?: string;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  directManageColumns?: boolean;
  onClearFilters?: () => void;
  /** Saved view tabs */
  savedTabs?: SavedViewTab[];
  /** Active tab id */
  activeTab?: string;
  /** Tab change handler */
  onTabChange?: (tabId: string) => void;
  /** Filter rail groups */
  filterContent?: ReactNode;
  filterGroups?: FilterGroup[];
  /** Filter toggle handler */
  onFilterToggle?: (groupId: string, itemId: string) => void;
  /** Filter search term */
  filterSearchTerm?: string;
  /** Filter search handler */
  onFilterSearch?: (term: string) => void;
  /** Show filter rail */
  showFilters?: boolean;
  /** Toggle filter rail visibility */
  onToggleFilters?: () => void;
  /** Total record count for filter rail footer */
  totalRecords?: number;
  /** Module search term */
  searchTerm?: string;
  /** Module search handler */
  onSearch?: (term: string) => void;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Sortable fields for the sort dropdown (dynamic per module) */
  sortableFields?: SortableField[];
  /** Current sort preference (controlled) */
  sort?: SortPreference | null;
  /** Sort change handler */
  onSortChange?: (sort: SortPreference | null) => void;
  /** Current records per page (controlled) */
  pageSize?: number;
  /** Page size change handler */
  onPageSizeChange?: (size: number) => void;
  /** Current view mode (controlled) */
  viewMode?: ViewMode;
  /** View mode change handler */
  onViewModeChange?: (mode: ViewMode) => void;
  /** Refresh handler */
  onRefresh?: () => void;
  /** KPI strip cards (Accounts, Deals) */
  kpiCards?: KpiCard[];
  /** Extra toolbar content (e.g. pipeline selector) */
  toolbarExtra?: ReactNode;
  /** Content area — the actual view (table/cards/kanban) */
  children: ReactNode;
  /** Bulk selection bar */
  bulkSelection?: { count: number; onClear: () => void; actions: ReactNode };
  /** Handler for "Manage Columns" (opens ManageColumnsDrawer in parent) */
  onManageColumns?: () => void;
  /** Handler for "Reset Column Size" */
  onResetColumns?: () => void;

  // ── Pagination Props (Task 13.2) ──────────────────────────────────────────
  /** Current page number (1-based) for pagination controls */
  currentPage?: number;
  /** Total records count for pagination display */
  paginationTotalRecords?: number;
  /** Page change handler */
  onPageChange?: (page: number) => void;
}

// ── View Icons Map ─────────────────────────────────────────────────────────────

// ── View Icons Map ─────────────────────────────────────────────────────────────

const VIEW_ICON_MAP: Record<ViewType, ViewOption> = {
  list: { id: 'list', label: 'List View', icon: List },
  tile: { id: 'tile', label: 'Tile View', icon: LayoutGrid },
  table: { id: 'table', label: 'Table View', icon: Table2 },
  kanban: { id: 'kanban', label: 'Kanban View', icon: Columns3 },
  grid: { id: 'grid', label: 'Grid View', icon: Grid3X3 },
  forecast: { id: 'forecast', label: 'Forecast View', icon: TrendingUp },
};

const PAGE_SIZE_OPTIONS = [10, 20, 25, 30, 40, 50] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function ModuleWorkspace({
  moduleId,
  title,
  description,
  primaryActionLabel,
  onPrimaryAction,
  onImport,
  canCreate = true,
  availableViews,
  activeView,
  onViewChange,
  moduleConfig,
  viewData,
  viewColumns,
  onRowClick,
  onRowSelect,
  selectedIds,
  isDataLoading,
  loading = false,
  loadingLabel = 'Loading records...',
  refreshDisabled = false,
  refreshLabel,
  directManageColumns = false,
  onClearFilters,
  filterContent,
  savedTabs,
  activeTab,
  onTabChange,
  filterGroups,
  onFilterToggle,
  filterSearchTerm = '',
  onFilterSearch,
  showFilters = false,
  onToggleFilters,
  totalRecords = 0,
  searchTerm = '',
  onSearch,
  searchPlaceholder = 'Search records...',
  // sortableFields, sort, onSortChange retained on props for backward compat
  // but the global Sort button has been removed — sorting is per-column in DataGrid
  pageSize = 25,
  onPageSizeChange,
  viewMode = 'wrap',
  onViewModeChange,
  onRefresh,
  kpiCards,
  toolbarExtra,
  children,
  bulkSelection,
  onManageColumns,
  onResetColumns,
  currentPage = 1,
  paginationTotalRecords,
  onPageChange,
}: ModuleWorkspaceProps): React.ReactElement {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  // ── Module_Config validation on mount ──────────────────────────────────────
  // Throws to ErrorBoundary on invalid config (development-time guard)
  useMemo(() => {
    if (moduleConfig) {
      validateModuleConfig(moduleConfig);
    }
  }, [moduleConfig]);

  // ── View Type Preference (Data_View_System) ────────────────────────────────
  // When moduleConfig is provided, use the persisted view type hook
  const configViewPref = useViewTypePreference(
    moduleConfig?.moduleId ?? '__noop__',
    moduleConfig?.availableViews?.[0] ?? 'table',
  );

  // Resolve effective view type: moduleConfig-driven hook takes priority when moduleConfig present
  const effectiveViewType: ViewType = moduleConfig
    ? (configViewPref.viewType as ViewType)
    : activeView;

  // Resolve effective view change handler
  const effectiveViewChange = useCallback((view: ViewType) => {
    if (moduleConfig) {
      configViewPref.setViewType(view as SharedViewType);
    }
    onViewChange(view);
  }, [moduleConfig, configViewPref, onViewChange]);

  // ── Sort state and sortable fields are retained on the props interface
  // for backward compatibility, but the global Sort button has been removed.
  // Per-column sorting is handled directly inside the DataGrid component.

  // ── Available views from Module_Config ─────────────────────────────────────
  const effectiveAvailableViews = useMemo((): ViewType[] => {
    if (moduleConfig) {
      return moduleConfig.availableViews as ViewType[];
    }
    return availableViews;
  }, [moduleConfig, availableViews]);

  // ── Resolve active View Renderer from VIEW_OPTIONS ─────────────────────────
  const ActiveViewRenderer = useMemo(() => {
    if (!moduleConfig) return null;
    const viewType = effectiveViewType as SharedViewType;
    return VIEW_RENDERERS[viewType] ?? null;
  }, [moduleConfig, effectiveViewType]);

  const handleViewSelect = useCallback((view: ViewType) => {
    effectiveViewChange(view);
    setViewMenuOpen(false);
  }, [effectiveViewChange]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <PageHeader title={title} subtitle={description} actions={<>
        {canCreate && <CreateActionDropdown primaryActionLabel={primaryActionLabel} onPrimaryAction={onPrimaryAction} onImport={onImport} />}
        {!canCreate && onImport && <button onClick={onImport} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Import File</button>}
      </>} />

      {/* ── Saved View Tabs ─────────────────────────────────────────── */}
      {savedTabs && savedTabs.length > 0 && (
        <div className="flex items-center gap-1 mb-3 border-b border-[#E4E9F0] dark:border-slate-700">
          {savedTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange?.(tab.id)}
              className={cn(
                'px-3 py-2 text-[13px] font-medium transition-colors relative',
                activeTab === tab.id
                  ? 'text-primary dark:text-primary'
                  : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white',
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      {/* Control order: search → filter toggle → sort dropdown → page-size selector → pagination nav (Req 8.1) */}
      {/* Mobile: search on row 1 (full width), all secondary controls on row 2 via flex-col */}
      <div data-selection-toolbar className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mb-3" role="toolbar" aria-label="Module controls">
        {/* 1. Search field — full width on mobile, fixed width on sm+ */}
        <ModuleSearchInput value={searchTerm} onChange={value => onSearch?.(value)} placeholder={searchPlaceholder} />

        {/* Row 2 on mobile / inline on sm+: all secondary controls */}
        {/* sm:contents dissolves this wrapper on sm+ so children participate directly in the parent flex */}
        <div className="flex flex-wrap items-center gap-2 sm:contents">

          {/* 2. Filter toggle */}
          <FilterButton title={title} open={showFilters} onClick={onToggleFilters} />

          {/* 3. Page-size selector */}
          {!loading && !isDataLoading && onPageSizeChange && (
            <PageSizeSelectorInline pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
          )}

          {/* 5. Pagination nav (compact toolbar variant) */}
          {!loading && !isDataLoading && onPageChange && (paginationTotalRecords ?? totalRecords) > 0 && (
            <PaginationNavInline
              currentPage={currentPage}
              totalRecords={paginationTotalRecords ?? totalRecords}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* View Switcher — Desktop: segmented control | Mobile: dropdown only */}
          {/* Only show when more than 1 view is available */}
          {effectiveAvailableViews.length > 1 && (
          <div className={cn(
            'inline-flex items-center bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg p-0.5',
            effectiveAvailableViews.length > 1 ? 'hidden sm:inline-flex' : 'inline-flex',
          )}>
            {effectiveAvailableViews.map((viewId) => {
              const viewOption = VIEW_ICON_MAP[viewId];
              const Icon = viewOption.icon;
              const isActive = effectiveViewType === viewId;
              return (
                <button
                  key={viewId}
                  onClick={() => effectiveViewChange(viewId)}
                  title={viewOption.label}
                  aria-label={viewOption.label}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700',
                  )}
                >
                  <Icon size={15} />
                </button>
              );
            })}

            {/* View dropdown chevron (always visible) */}
            <div className="relative">
              <button
                onClick={() => setViewMenuOpen(!viewMenuOpen)}
                className="p-1.5 text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white rounded-md transition-colors"
                aria-label="View options"
              >
                <ChevronDown size={13} />
              </button>
              <AnimatePresence>
                {viewMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full right-0 mt-1 w-44 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-30 py-1.5 overflow-hidden"
                  >
                    {effectiveAvailableViews.map((viewId) => {
                      const viewOption = VIEW_ICON_MAP[viewId];
                      const Icon = viewOption.icon;
                      const isActive = effectiveViewType === viewId;
                      return (
                        <button
                          key={viewId}
                          onClick={() => handleViewSelect(viewId)}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors',
                            isActive
                              ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                              : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                          )}
                        >
                          <Icon size={15} />
                          {viewOption.label}
                          {isActive && <span className="ml-auto text-primary">✓</span>}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          )}

          {/* Mobile view dropdown (visible only on small screens when >1 view) */}
          {effectiveAvailableViews.length > 1 && (
            <div className="relative sm:hidden">
              <button
                onClick={() => setViewMenuOpen(!viewMenuOpen)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#5A6B85] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                aria-label="Switch view"
                aria-expanded={viewMenuOpen}
                aria-haspopup="true"
              >
                {(() => {
                  const currentIcon = VIEW_ICON_MAP[effectiveViewType];
                  const CurrentIcon = currentIcon.icon;
                  return <CurrentIcon size={14} />;
                })()}
                <span>{VIEW_ICON_MAP[effectiveViewType].label}</span>
                <ChevronDown size={12} />
              </button>
              <AnimatePresence>
                {viewMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1 w-44 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-30 py-1.5 overflow-hidden"
                  >
                    {effectiveAvailableViews.map((viewId) => {
                      const viewOption = VIEW_ICON_MAP[viewId];
                      const Icon = viewOption.icon;
                      const isActive = effectiveViewType === viewId;
                      return (
                        <button
                          key={viewId}
                          onClick={() => handleViewSelect(viewId)}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors',
                            isActive
                              ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                              : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                          )}
                        >
                          <Icon size={15} />
                          {viewOption.label}
                          {isActive && <Check size={13} className="ml-auto text-primary" />}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Refresh */}
          {onRefresh && (
            <RefreshButton onClick={() => onRefresh()} disabled={refreshDisabled || loading} refreshing={loading} label={refreshLabel} />
          )}

          {/* Extra toolbar (pipeline selector, etc.) */}
          {toolbarExtra}

          {/* Table Settings Menu (Manage Columns, Reset Columns, View Mode) */}
          {directManageColumns ? (
            <ManageColumnsButton onClick={onManageColumns} />
          ) : <TableSettingsMenuInline
            pageSize={pageSize}
            onPageSizeChange={onPageSizeChange}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            onManageColumns={onManageColumns}
            onResetColumns={onResetColumns}
          />}

        </div>{/* end secondary controls row */}
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────── */}
      {kpiCards && kpiCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {kpiCards.map((kpi) => (
            <div
              key={kpi.label}
              className="bg-white dark:bg-slate-800/60 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-3.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400 mb-1">
                {kpi.label}
              </p>
              <p className="text-xl font-extrabold text-[#0F172A] dark:text-white tabular-nums">
                {kpi.value}
              </p>
              {kpi.subtitle && (
                <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 mt-0.5">
                  {kpi.subtitle}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Main Content Area ───────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 gap-0">
        <ModuleFilterRail filterContent={filterContent}
          onClearFilters={onClearFilters}
          showFilters={showFilters}
          filterGroups={filterGroups}
          onToggleFilters={onToggleFilters}
          filterSearchTerm={filterSearchTerm}
          onFilterSearch={onFilterSearch}
          onFilterToggle={onFilterToggle}
          totalRecords={totalRecords}
        />

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Render active view from VIEW_OPTIONS registry when moduleConfig is provided */}
          {loading ? (
            <TableLoadingState label={loadingLabel} />
          ) : moduleConfig && ActiveViewRenderer && viewData && viewColumns ? (
            <ActiveViewRenderer
              data={viewData}
              columns={viewColumns}
              columnRegistry={moduleConfig.columnRegistry}
              viewMode={viewMode}
              onRowClick={onRowClick}
              onRowSelect={onRowSelect}
              selectedIds={selectedIds}
              isLoading={isDataLoading}
            />
          ) : (
            children
          )}

          {/* Pagination Controls (Task 13.2) */}
          {!loading && !isDataLoading && onPageChange && onPageSizeChange && (
            <PaginationControls
              currentPage={currentPage}
              totalRecords={paginationTotalRecords ?? totalRecords}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          )}
        </div>
      </div>

      {bulkSelection && <SelectedRowsBar count={bulkSelection.count} onClear={bulkSelection.onClear}>{bulkSelection.actions}</SelectedRowsBar>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Table Settings Menu (inline sub-component)
// Manage Columns | Reset Column Size | Records Per Page ▸ | View Mode ▸
// ═══════════════════════════════════════════════════════════════════════════════

interface TableSettingsMenuInlineProps {
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
  viewMode: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onManageColumns?: () => void;
  onResetColumns?: () => void;
}

function TableSettingsMenuInline({
  pageSize,
  onPageSizeChange,
  viewMode,
  onViewModeChange,
  onManageColumns,
  onResetColumns,
}: TableSettingsMenuInlineProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'pageSize' | 'viewMode' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveSubmenu(null);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setActiveSubmenu(null);
      }
    }
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <TooltipProvider><Tooltip><TooltipTrigger asChild>
      <button
        onClick={() => { setIsOpen((prev) => !prev); setActiveSubmenu(null); }}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[12px] font-medium text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        aria-label="Table settings"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Settings2 size={14} aria-hidden="true" />
      </button>
      </TooltipTrigger><TooltipContent>Table settings</TooltipContent></Tooltip></TooltipProvider>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5 overflow-visible">
          {/* Manage Columns */}
          {onManageColumns && (
            <button
              onClick={() => { menuRef.current?.querySelector('button')?.focus(); onManageColumns(); setIsOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Settings2 size={14} className="text-[#5A6B85] dark:text-slate-400" />
              Manage Columns
            </button>
          )}

          {/* Reset Column Size */}
          {onResetColumns && (
            <button
              onClick={() => { onResetColumns(); setIsOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Columns3 size={14} className="text-[#5A6B85] dark:text-slate-400" />
              Reset Column Size
            </button>
          )}

          {/* Separator + Records Per Page (only when page size control is available) */}
          {onPageSizeChange && (
            <>
              <div className="my-1.5 border-t border-[#E4E9F0] dark:border-slate-700" />

              {/* Records Per Page */}
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('pageSize')}
                onMouseLeave={() => setActiveSubmenu(null)}
              >
                <button
                  onClick={() => setActiveSubmenu('pageSize')}
                  aria-expanded={activeSubmenu === 'pageSize'}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  aria-haspopup="true"
                >
                  <ListOrdered size={14} className="text-[#5A6B85] dark:text-slate-400" />
                  <span className="flex-1 text-left">Records Per Page</span>
                  <span className="text-[12px] font-semibold text-[#0F172A] dark:text-slate-200 mr-1">{pageSize}</span>
                  <ChevronRight size={12} className="text-[#5A6B85] dark:text-slate-400" />
                </button>

                {activeSubmenu === 'pageSize' && (
                  <div className="relative mx-2 my-1 sm:absolute sm:right-full sm:top-0 sm:mr-1 sm:ml-0 sm:my-0 sm:w-32 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        onClick={() => { onPageSizeChange?.(size); setIsOpen(false); setActiveSubmenu(null); }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                          pageSize === size
                            ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                            : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                        )}
                      >
                        {pageSize === size ? <Check size={13} className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
                        {size}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Separator before View Mode when Records Per Page is not shown */}
          {!onPageSizeChange && (onManageColumns || onResetColumns) && (
            <div className="my-1.5 border-t border-[#E4E9F0] dark:border-slate-700" />
          )}

          {/* View Mode */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSubmenu('viewMode')}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <button
              onClick={() => setActiveSubmenu('viewMode')}
              aria-expanded={activeSubmenu === 'viewMode'}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              aria-haspopup="true"
            >
              <Eye size={14} className="text-[#5A6B85] dark:text-slate-400" />
              <span className="flex-1 text-left">View Mode</span>
              <span className="text-[12px] font-semibold text-[#0F172A] dark:text-slate-200 mr-1">
                {viewMode === 'wrap' ? 'Wrap Text' : 'Clip Text'}
              </span>
              <ChevronRight size={12} className="text-[#5A6B85] dark:text-slate-400" />
            </button>

            {activeSubmenu === 'viewMode' && (
              <div className="relative mx-2 my-1 sm:absolute sm:right-full sm:top-0 sm:mr-1 sm:ml-0 sm:my-0 sm:w-36 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                <button
                  onClick={() => { onViewModeChange?.('wrap'); setIsOpen(false); setActiveSubmenu(null); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    viewMode === 'wrap'
                      ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                      : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                  )}
                >
                  {viewMode === 'wrap' ? <Check size={13} className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
                  Wrap Text
                </button>
                <button
                  onClick={() => { onViewModeChange?.('clip'); setIsOpen(false); setActiveSubmenu(null); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    viewMode === 'clip'
                      ? 'text-primary dark:text-primary bg-blue-50 dark:bg-primary/10'
                      : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                  )}
                >
                  {viewMode === 'clip' ? <Check size={13} className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
                  Clip Text
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page Size Selector (inline toolbar sub-component)
// Compact dropdown for selecting records per page directly in the toolbar
// ═══════════════════════════════════════════════════════════════════════════════

interface PageSizeSelectorInlineProps {
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

function PageSizeSelectorInline({ pageSize, onPageSizeChange }: PageSizeSelectorInlineProps): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-1.5">
      <label
        htmlFor="toolbar-page-size"
        className="text-[11.5px] text-[#5A6B85] dark:text-slate-400 whitespace-nowrap"
      >
        Per page
      </label>
      <select
        id="toolbar-page-size"
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        className="h-8 px-2 pr-6 text-[12px] font-medium rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none"
        aria-label="Records per page"
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination Nav (inline toolbar sub-component)
// Compact prev/next navigation + page indicator for the toolbar
// ═══════════════════════════════════════════════════════════════════════════════

interface PaginationNavInlineProps {
  currentPage: number;
  totalRecords: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function PaginationNavInline({ currentPage, totalRecords, pageSize, onPageChange }: PaginationNavInlineProps): React.ReactElement {
  const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSize) : 0;
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[11.5px] text-[#5A6B85] dark:text-slate-400 tabular-nums whitespace-nowrap">
        {currentPage} / {totalPages || 1}
      </span>
      <button
        onClick={() => !isFirstPage && onPageChange(currentPage - 1)}
        disabled={isFirstPage}
        className={cn(
          'inline-flex items-center justify-center w-7 h-7 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-md border transition-colors',
          isFirstPage
            ? 'border-[#E4E9F0] dark:border-slate-700 text-[#C5CDD8] dark:text-slate-600 cursor-not-allowed'
            : 'border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-[#0F172A] dark:hover:text-white',
        )}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <button
        onClick={() => !isLastPage && onPageChange(currentPage + 1)}
        disabled={isLastPage}
        className={cn(
          'inline-flex items-center justify-center w-7 h-7 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-md border transition-colors',
          isLastPage
            ? 'border-[#E4E9F0] dark:border-slate-700 text-[#C5CDD8] dark:text-slate-600 cursor-not-allowed'
            : 'border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-[#0F172A] dark:hover:text-white',
        )}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Filter Group Sub-component ─────────────────────────────────────────────────

export { FilterGroupSection } from './module-filter-rail';

interface CreateActionDropdownProps {
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onImport?: () => void;
}

export function CreateActionDropdown({ primaryActionLabel, onPrimaryAction, onImport }: CreateActionDropdownProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  if (!onImport) return <CreateButton label={primaryActionLabel} onClick={onPrimaryAction} />;

  return (
    <div ref={dropdownRef} className="relative">
      <CreateButton label={primaryActionLabel} onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} aria-haspopup="menu">
        <ChevronDown size={14} className={cn('hidden sm:block opacity-60 transition-transform', isOpen && 'rotate-180')} />
      </CreateButton>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full right-0 mt-1.5 w-48 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1"
            role="menu"
          >
            <button
              onClick={() => { dropdownRef.current?.querySelector('button')?.focus(); onPrimaryAction(); setIsOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
              role="menuitem"
            >
              <UserPlus size={15} className="text-slate-500 dark:text-slate-400" />
              Create New
            </button>
            <button
              onClick={() => { onImport(); setIsOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
              role="menuitem"
            >
              <FileUp size={15} className="text-slate-500 dark:text-slate-400" />
              Import File
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
