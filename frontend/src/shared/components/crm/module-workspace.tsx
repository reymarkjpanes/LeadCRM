'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo, ReactNode } from 'react';
import {
  List, LayoutGrid, Table2, Columns3, Grid3X3,
  TrendingUp, Filter, RefreshCw, Search,
  Settings2, ChevronDown, ChevronLeft, ChevronRight, X, Upload,
  ListOrdered, Eye, Check, FileUp, UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import type { SortPreference, ViewMode } from '@/shared/hooks/use-table-preferences';
import type { ModuleConfig, ViewType as SharedViewType, ColumnConfigItem } from '@leadcrm/shared';
import { useViewTypePreference } from '@/shared/hooks/use-view-type-preference';
import { VIEW_OPTIONS as VIEW_RENDERERS } from './view-registry';
import { validateModuleConfig } from './validate-module-config';
import { PaginationControls } from './pagination-controls';

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

interface FilterGroup {
  id: string;
  label: string;
  isExpanded?: boolean;
  items: FilterItem[];
}

interface FilterItem {
  id: string;
  label: string;
  count?: number;
  isChecked?: boolean;
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
  /** Saved view tabs */
  savedTabs?: SavedViewTab[];
  /** Active tab id */
  activeTab?: string;
  /** Tab change handler */
  onTabChange?: (tabId: string) => void;
  /** Filter rail groups */
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[28px] font-extrabold text-[#0F172A] dark:text-white tracking-tight leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-[13px] text-[#5A6B85] dark:text-slate-400 mt-0.5">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <CreateActionDropdown
              primaryActionLabel={primaryActionLabel}
              onPrimaryAction={onPrimaryAction}
              onImport={onImport}
            />
          )}
        </div>
      </div>

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
                  ? 'text-[#2563EB] dark:text-blue-400'
                  : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white',
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2563EB] dark:bg-blue-400 rounded-full" />
              )}
            </button>
          ))}
          <button className="px-2 py-2 text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white transition-colors">
            <span className="text-lg leading-none">···</span>
          </button>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      {/* Control order: search → filter toggle → sort dropdown → page-size selector → pagination nav (Req 8.1) */}
      <div className="flex flex-wrap items-center gap-2 mb-3" role="toolbar" aria-label="Module controls">
        {/* 1. Search field */}
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 w-48 lg:w-56 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-all"
          />
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" aria-hidden="true" />
        </div>

        {/* 2. Filter toggle */}
        <button
          onClick={onToggleFilters}
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-semibold rounded-lg border transition-colors',
            showFilters
              ? 'bg-[#2563EB] text-white border-[#2563EB]'
              : 'bg-white dark:bg-slate-800 text-[#5A6B85] dark:text-slate-300 border-[#E4E9F0] dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
          )}
        >
          <Filter size={13} />
          Filter
        </button>

        {/* 3. Page-size selector */}
        {onPageSizeChange && (
          <PageSizeSelectorInline pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
        )}

        {/* 5. Pagination nav (compact toolbar variant) */}
        {onPageChange && (paginationTotalRecords ?? totalRecords) > 0 && (
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
                    ? 'bg-[#2563EB] text-white shadow-sm'
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
                            ? 'text-[#2563EB] dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
                            : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                        )}
                      >
                        <Icon size={15} />
                        {viewOption.label}
                        {isActive && <span className="ml-auto text-[#2563EB]">✓</span>}
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
                            ? 'text-[#2563EB] dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
                            : 'text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                        )}
                      >
                        <Icon size={15} />
                        {viewOption.label}
                        {isActive && <Check size={13} className="ml-auto text-[#2563EB]" />}
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
          <button
            onClick={onRefresh}
            className="p-1.5 text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        )}

        {/* Extra toolbar (pipeline selector, etc.) */}
        {toolbarExtra}

        {/* Table Settings Menu (Manage Columns, Reset Columns, View Mode) */}
        <TableSettingsMenuInline
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onManageColumns={onManageColumns}
          onResetColumns={onResetColumns}
        />
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
        {/* Filter Rail */}
        <AnimatePresence>
          {showFilters && filterGroups && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="shrink-0 overflow-hidden"
            >
              <div className="w-[260px] h-full flex flex-col bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl mr-3 overflow-hidden">
                {/* Filter header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E9F0] dark:border-slate-700">
                  <span className="text-[13px] font-semibold text-[#0F172A] dark:text-white">
                    Filter by
                  </span>
                  <button
                    onClick={onToggleFilters}
                    className="p-1 text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white rounded transition-colors"
                    aria-label="Close filters"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Filter search */}
                <div className="px-3 py-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={filterSearchTerm}
                      onChange={(e) => onFilterSearch?.(e.target.value)}
                      placeholder="Search filters"
                      aria-label="Search filters"
                      className="w-full h-8 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 transition-all"
                    />
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" aria-hidden="true" />
                  </div>
                </div>

                {/* Filter groups */}
                <div className="flex-1 overflow-y-auto px-3 py-1 custom-scrollbar">
                  {filterGroups.map((group) => (
                    <FilterGroupSection
                      key={group.id}
                      group={group}
                      filterSearchTerm={filterSearchTerm}
                      onToggle={onFilterToggle}
                    />
                  ))}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 text-[11.5px] text-[#5A6B85] dark:text-slate-400">
                  {totalRecords} records in this module
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Render active view from VIEW_OPTIONS registry when moduleConfig is provided */}
          {moduleConfig && ActiveViewRenderer && viewData && viewColumns ? (
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
          {onPageChange && onPageSizeChange && (
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

      {/* ── Bulk Selection Bar ───────────────────────────────────────── */}
      <AnimatePresence>
        {bulkSelection && bulkSelection.count > 0 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#0F172A] dark:bg-slate-700 text-white rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-3 text-[13px]"
          >
            <span className="font-semibold">{bulkSelection.count} selected</span>
            <button
              onClick={bulkSelection.onClear}
              className="text-slate-300 hover:text-white text-[12px] underline transition-colors"
            >
              Clear
            </button>
            <div className="h-4 w-px bg-slate-600" />
            {bulkSelection.actions}
          </motion.div>
        )}
      </AnimatePresence>
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
      <button
        onClick={() => { setIsOpen((prev) => !prev); setActiveSubmenu(null); }}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[12px] font-medium text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        aria-label="Table settings"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Settings2 size={14} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5 overflow-visible">
          {/* Manage Columns */}
          {onManageColumns && (
            <button
              onClick={() => { onManageColumns(); setIsOpen(false); }}
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
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  aria-haspopup="true"
                >
                  <ListOrdered size={14} className="text-[#5A6B85] dark:text-slate-400" />
                  <span className="flex-1 text-left">Records Per Page</span>
                  <span className="text-[12px] font-semibold text-[#0F172A] dark:text-slate-200 mr-1">{pageSize}</span>
                  <ChevronRight size={12} className="text-[#5A6B85] dark:text-slate-400" />
                </button>

                {activeSubmenu === 'pageSize' && (
                  <div className="absolute right-full top-0 mr-1 w-32 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        onClick={() => { onPageSizeChange?.(size); setIsOpen(false); setActiveSubmenu(null); }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                          pageSize === size
                            ? 'text-[#2563EB] dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
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
              <div className="absolute right-full top-0 mr-1 w-36 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-xl shadow-lg z-50 py-1.5">
                <button
                  onClick={() => { onViewModeChange?.('wrap'); setIsOpen(false); setActiveSubmenu(null); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
                    viewMode === 'wrap'
                      ? 'text-[#2563EB] dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
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
                      ? 'text-[#2563EB] dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
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
        className="h-8 px-2 pr-6 text-[12px] font-medium rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 cursor-pointer appearance-none"
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
          'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
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
          'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
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

interface FilterGroupSectionProps {
  group: FilterGroup;
  filterSearchTerm?: string;
  onToggle?: (groupId: string, itemId: string) => void;
}

function FilterGroupSection({ group, filterSearchTerm = '', onToggle }: FilterGroupSectionProps): React.ReactElement | null {
  const [isExpanded, setIsExpanded] = useState(group.isExpanded ?? true);

  const visibleItems = React.useMemo(() => {
    if (!filterSearchTerm.trim()) return group.items;
    const term = filterSearchTerm.toLowerCase().trim();
    return group.items.filter((item) => item.label.toLowerCase().includes(term));
  }, [group.items, filterSearchTerm]);

  if (visibleItems.length === 0 && filterSearchTerm.trim()) {
    return null;
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 w-full text-left py-1.5"
      >
        <ChevronDown
          size={12}
          className={cn(
            'text-[#5A6B85] transition-transform',
            !isExpanded && '-rotate-90',
          )}
        />
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400">
          {group.label}
        </span>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 pl-1">
              {visibleItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={item.isChecked ?? false}
                    onChange={() => onToggle?.(group.id, item.id)}
                    className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer"
                    aria-label={`Filter by ${item.label}`}
                  />
                  <span className="flex-1 text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate min-w-0">
                    {item.label}
                  </span>
                  {item.count !== undefined && (
                    <span className="text-[11px] text-[#5A6B85] dark:text-slate-500 tabular-nums shrink-0">
                      {item.count}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Create Action Dropdown ─────────────────────────────────────────────────────

interface CreateActionDropdownProps {
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onImport?: () => void;
}

function CreateActionDropdown({ primaryActionLabel, onPrimaryAction, onImport }: CreateActionDropdownProps): React.ReactElement {
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

  // If no import action, just render the primary button directly (no dropdown)
  if (!onImport) {
    return (
      <button
        onClick={onPrimaryAction}
        className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors shadow-sm"
      >
        <span className="text-base leading-none">+</span>
        {primaryActionLabel}
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors shadow-sm"
      >
        <span className="text-base leading-none">+</span>
        {primaryActionLabel}
        <ChevronDown size={14} className={cn('ml-0.5 opacity-60 transition-transform', isOpen && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full right-0 mt-1.5 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1"
            role="menu"
          >
            <button
              onClick={() => { onPrimaryAction(); setIsOpen(false); }}
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
