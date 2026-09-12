'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import type { Lead, Organization } from '@/store/types';
import { ModuleWorkspace, ViewType, LeadPanel, StatusBadge } from '@/shared/components/crm';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useFilterUrlSync } from '@/shared/hooks/use-filter-url-sync';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useColumnPreferences } from '@/shared/hooks/use-column-preferences';
import { useTablePreferences } from '@/shared/hooks/use-table-preferences';
import { migrateLocalStorageColumns } from '../services/local-storage-migration';
import { ManageColumnsDrawer } from '@/shared/components/manage-columns-drawer';
import { LeadsTileView, LeadsGridView, LeadsKanbanView, LeadDrawerOverview, LeadDrawerRelated } from './leads-view-components';
import { LeadsListView } from './leads-list-view';
import { LeadsDataGrid } from './leads-data-grid';
import { LeadFormSheet } from './lead-form';
import { ConvertLeadDialog } from './convert-lead-dialog';
import { MergeRecordsDialog } from '@/shared/components/crm/merge-records-dialog';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { useRouter } from 'next/navigation';
// @deprecated — ImportLeadsDrawer replaced by full-page import at /crm/leads/import
// import { ImportLeadsDrawer } from './import-leads-drawer';
import { LEADS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { LEADS_MODULE_CONFIG } from '../leads.config';
import { toast } from 'sonner';
import { Edit, Phone, Mail, ListTodo, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageSizeSelect } from '@/shared/components/page-size-select';

// ── Leads Page ────────────────────────────────────────────────────────────────

export default function LeadsPage(): React.ReactElement {
  const router = useRouter();
  const {
    contacts: leads,
    addContact: addLead,
    updateContact: updateLead,
    deleteContact: deleteLead,
    refreshContacts,
    users,
    organizations,
  } = useData();
  const { user } = useAuth();
  const canCreate = useHasPermission('contacts.create');
  const canEdit = useHasPermission('contacts.edit');
  const canDelete = useHasPermission('contacts.delete');
  const { getParam, getArrayParam, updateParams } = useFilterUrlSync('leads');

  // ── Column Preferences ────────────────────────────────────────────────
  const {
    effectiveColumns,
    isLoading: isColumnsLoading,
    saveColumns,
    resetColumns,
  } = useColumnPreferences('leads');

  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);

  // ── Table Preferences (pageSize, viewMode, sort) ──────────────────────
  const {
    pageSize,
    viewMode,
    sort,
    setPageSize,
    setViewMode,
    setSort,
    persistFilters,
  } = useTablePreferences('leads');

  // ── Pagination state ──────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);

  // ── One-time localStorage migration (fire-and-forget) ─────────────────
  useEffect(() => {
    migrateLocalStorageColumns();
  }, []);

  /** Visible columns sorted by order — drives table rendering */
  const visibleColumns = useMemo(() => {
    if (effectiveColumns.length === 0) {
      // Fallback to system default when no preferences loaded yet
      return LEADS_COLUMN_REGISTRY
        .filter((col) => col.defaultVisible)
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((col) => ({ id: col.id, visible: true, order: col.defaultOrder }));
    }
    return [...effectiveColumns]
      .filter((col) => col.visible)
      .sort((a, b) => a.order - b.order);
  }, [effectiveColumns]);

  // ── State ────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ViewType>(() => (getParam('view') as ViewType) || 'list');
  const [activeTab, setActiveTab] = useState(() => getParam('tab') || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => getParam('search'));
  const [filterSearchTerm, setFilterSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | undefined>();
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [mergingLead, setMergingLead] = useState<Lead | null>(null);
  const [mergeSecondaryId, setMergeSecondaryId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [drawerTab, setDrawerTab] = useState('overview');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Multi-criteria filter state
  const [selectedSystemFilters, setSelectedSystemFilters] = useState<string[]>(() => getArrayParam('system'));
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() => getArrayParam('statuses'));
  const [selectedSources, setSelectedSources] = useState<string[]>(() => getArrayParam('sources'));
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
      statuses: selectedStatuses,
      sources: selectedSources,
      owners: selectedOwners,
      related: selectedRelated,
    });
  }, [activeTab, debouncedSearch, activeView, selectedSystemFilters, selectedStatuses, selectedSources, selectedOwners, selectedRelated, updateParams]);

  // -- Persist filter selections (fire-and-forget) ------------------------
  useEffect(() => {
    const conditions: { field: string; operator: string; value: unknown }[] = [];
    if (selectedStatuses.length > 0) {
      conditions.push({ field: 'status', operator: 'in', value: selectedStatuses });
    }
    if (selectedSources.length > 0) {
      conditions.push({ field: 'leadSource', operator: 'in', value: selectedSources });
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
  }, [selectedStatuses, selectedSources, selectedOwners, selectedRelated, selectedSystemFilters, persistFilters]);

  // ── Filtered Data ────────────────────────────────────────────────────
  const activeLeads = useMemo(
    () => leads.filter((l) => !l.isArchived && l.recordType !== 'Organization'),
    [leads],
  );

  const filteredLeads = useMemo(() => {
    let result = activeLeads;

    // Tab filter
    if (activeTab === 'my') {
      result = result.filter((l) => l.assignedUserId === user?.id);
    }
    if (activeTab === 'active') {
      result = result.filter((l) => l.status === 'Hot' || l.status === 'Warm' || l.status === 'Inquiry');
    }

    // Search
    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      result = result.filter(
        (l) =>
          (l.leadPerson ?? l.displayName ?? '').toLowerCase().includes(term) ||
          (l.email ?? '').toLowerCase().includes(term) ||
          (l.companyName ?? '').toLowerCase().includes(term),
      );
    }

    // System Filters
    if (selectedSystemFilters.includes('touched')) {
      result = result.filter((l) => l.lastUpdated || l.updateStatus);
    }
    if (selectedSystemFilters.includes('untouched')) {
      result = result.filter((l) => !l.lastUpdated && !l.updateStatus);
    }

    // Status filter
    if (selectedStatuses.length > 0) {
      result = result.filter((l) => selectedStatuses.includes(l.status));
    }

    // Source filter
    if (selectedSources.length > 0) {
      result = result.filter((l) => selectedSources.includes(l.leadSource ?? ''));
    }

    // Owner filter
    if (selectedOwners.length > 0) {
      result = result.filter((l) => selectedOwners.includes(l.assignedUserId ?? ''));
    }

    // Related filter
    if (selectedRelated.includes('has_email')) {
      result = result.filter((l) => Boolean(l.email));
    }
    if (selectedRelated.includes('has_phone')) {
      result = result.filter((l) => Boolean(l.phone));
    }

    return result;
  }, [activeLeads, activeTab, user?.id, debouncedSearch, selectedSystemFilters, selectedStatuses, selectedSources, selectedOwners, selectedRelated]);


  // Helpers needed by sortedLeads
  const getOwnerName = (userId?: string): string => {
    if (!userId) return 'Unassigned';
    const u = users.find((usr) => usr.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : 'Unknown';
  };

  /** Extract a sortable value from a lead by field id */
  const getFieldValue = (lead: Lead, field: string): string | number | null => {
    switch (field) {
      case 'firstName':
        return lead.leadPerson ?? lead.displayName ?? lead.firstName ?? '';
      case 'lastName':
        return lead.lastName ?? '';
      case 'email':
        return lead.email ?? '';
      case 'phone':
        return lead.phone ?? '';
      case 'companyName':
        return lead.companyName ?? '';
      case 'status':
        return lead.status ?? '';
      case 'source':
        return lead.leadSource ?? '';
      case 'createdAt':
        return lead.createdAt ?? '';
      case 'updatedAt':
        return (lead as unknown as Record<string, unknown>).updatedAt as string ?? '';
      case 'city':
      case 'address':
      case 'primaryAddressCityState':
        return lead.city ?? '';
      case 'assignedUserId':
        return getOwnerName(lead.assignedUserId);
      default:
        return (lead as unknown as Record<string, unknown>)[field] as string ?? '';
    }
  };

  // ── Sorted Data ──────────────────────────────────────────────────────
  const sortedLeads = useMemo(() => {
    if (!sort) return filteredLeads;

    const { field, direction } = sort;
    const sorted = [...filteredLeads].sort((a, b) => {
      const aVal = getFieldValue(a, field);
      const bVal = getFieldValue(b, field);

      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
      return direction === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredLeads, sort]);

  // ── Paginated Data ───────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / pageSize));

  // Reset page when filters/sort/pageSize change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, activeTab, selectedSystemFilters, selectedStatuses, selectedSources, selectedOwners, selectedRelated, pageSize, sort]);

  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedLeads.slice(start, start + pageSize);
  }, [sortedLeads, currentPage, pageSize]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const getInitials = (lead: Lead): string => {
    const name = lead.leadPerson ?? lead.displayName ?? lead.firstName ?? '';
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getLeadName = (lead: Lead): string => {
    return lead.leadPerson ?? lead.displayName ?? (`${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Unknown');
  };


  const getOwnerInitials = (userId?: string): string => {
    if (!userId) return '?';
    const u = users.find((usr) => usr.id === userId);
    if (!u) return '?';
    return `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase();
  };

  const getStatusVariant = (status: string): 'success' | 'info' | 'warn' | 'danger' | 'purple' | 'neutral' => {
    const map: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'purple' | 'neutral'> = {
      Qualified: 'success',
      New: 'info',
      Contacted: 'info',
      Nurturing: 'purple',
      Unqualified: 'danger',
      Hot: 'danger',
      Warm: 'warn',
      Cold: 'neutral',
    };
    return map[status] ?? 'neutral';
  };

  const formatCurrency = (value?: number): string => {
    if (!value) return '$0';
    if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
    return `$${value.toLocaleString()}`;
  };


  // ── Filter groups for the rail ───────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activeLeads.forEach((l) => {
      counts[l.status] = (counts[l.status] ?? 0) + 1;
    });
    return counts;
  }, [activeLeads]);

  const touchedCount = activeLeads.filter((l) => l.lastUpdated || l.updateStatus).length;
  const untouchedCount = activeLeads.length - touchedCount;

  const distinctSources = useMemo(() => {
    const set = new Set<string>();
    activeLeads.forEach((l) => { if (l.leadSource) set.add(l.leadSource); });
    return Array.from(set);
  }, [activeLeads]);

  const filterGroups = useMemo(() => [
    {
      id: 'system',
      label: 'System Defined Filters',
      isExpanded: true,
      items: [
        { id: 'touched', label: 'Updated Records', count: touchedCount, isChecked: selectedSystemFilters.includes('touched') },
        { id: 'untouched', label: 'Never Updated', count: untouchedCount, isChecked: selectedSystemFilters.includes('untouched') },
      ],
    },
    {
      id: 'fields',
      label: 'Filter By Fields',
      isExpanded: true,
      items: [
        ...Object.entries(statusCounts).map(([status, count]) => ({
          id: `status:${status}`,
          label: `Status: ${status}`,
          count,
          isChecked: selectedStatuses.includes(status),
        })),
        ...distinctSources.map((source) => ({
          id: `source:${source}`,
          label: `Source: ${source}`,
          count: activeLeads.filter((l) => l.leadSource === source).length,
          isChecked: selectedSources.includes(source),
        })),
        ...users.slice(0, 5).map((u) => ({
          id: `owner:${u.id}`,
          label: `Owner: ${u.firstName} ${u.lastName}`,
          count: activeLeads.filter((l) => l.assignedUserId === u.id).length,
          isChecked: selectedOwners.includes(u.id),
        })),
      ],
    },
    {
      id: 'related',
      label: 'Filter By Related Modules',
      isExpanded: true,
      items: [
        { id: 'has_email', label: 'Leads with Email', count: activeLeads.filter((l) => Boolean(l.email)).length, isChecked: selectedRelated.includes('has_email') },
        { id: 'has_phone', label: 'Leads with Phone', count: activeLeads.filter((l) => Boolean(l.phone)).length, isChecked: selectedRelated.includes('has_phone') },
      ],
    },
  ], [touchedCount, untouchedCount, selectedSystemFilters, statusCounts, selectedStatuses, distinctSources, activeLeads, selectedSources, users, selectedOwners, selectedRelated]);

  const handleFilterToggle = useCallback((groupId: string, itemId: string) => {
    if (groupId === 'system') {
      setSelectedSystemFilters((prev) =>
        prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
      );
    } else if (groupId === 'fields') {
      if (itemId.startsWith('status:')) {
        const status = itemId.replace('status:', '');
        setSelectedStatuses((prev) =>
          prev.includes(status) ? prev.filter((x) => x !== status) : [...prev, status],
        );
      } else if (itemId.startsWith('source:')) {
        const source = itemId.replace('source:', '');
        setSelectedSources((prev) =>
          prev.includes(source) ? prev.filter((x) => x !== source) : [...prev, source],
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
  const handleCreate = useCallback(() => {
    setEditingLead(undefined);
    setIsFormOpen(true);
  }, []);

  const handleRowClick = useCallback((lead: Lead) => {
    setSelectedLead(lead);
    setDrawerTab('overview');
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === paginatedLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedLeads.map((l) => l.id)));
    }
  }, [selectedIds.size, paginatedLeads]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <>
      <ModuleWorkspace
        moduleId="leads"
        title="Leads"
        moduleConfig={LEADS_MODULE_CONFIG}
        primaryActionLabel="Create Lead"
        onPrimaryAction={handleCreate}
        onImport={() => router.push('/crm/leads/import')}
        canCreate={canCreate}
        availableViews={['table']}
        activeView={'table' as ViewType}
        onViewChange={setActiveView}
        savedTabs={[
          { id: 'all', label: 'All Leads' },
          { id: 'my', label: 'My Leads' },
          { id: 'active', label: 'Active Leads' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        filterGroups={filterGroups}
        onFilterToggle={handleFilterToggle}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        filterSearchTerm={filterSearchTerm}
        onFilterSearch={setFilterSearchTerm}
        totalRecords={sortedLeads.length}
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        searchPlaceholder="Search leads..."
        pageSize={pageSize}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={() => toast.success('Data refreshed')}
        onManageColumns={() => setIsManageColumnsOpen(true)}
        onResetColumns={() => {
          resetColumns();
          toast.success('Columns reset to default');
        }}
        bulkSelection={
          selectedIds.size > 0
            ? {
                count: selectedIds.size,
                onClear: () => setSelectedIds(new Set()),
                actions: (
                  canDelete && (
                    <button
                      className="text-[12px] text-white/80 hover:text-white transition-colors"
                      onClick={async () => {
                        const ids = [...selectedIds];
                        try {
                          await Promise.all(ids.map((id) => deleteLead(id)));
                          setSelectedIds(new Set());
                          toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} deleted`);
                        } catch (err: unknown) {
                          toast.error(err instanceof Error ? err.message : 'Failed to delete leads');
                        }
                      }}
                    >
                      Delete
                    </button>
                  )
                ),
              }
            : undefined
        }
      >
        {/* ── List View ─────────────────────────────────────────── */}
        {(activeView === 'list' || activeView === 'table') && isColumnsLoading && (
          <div className="bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-8">
            <div className="flex items-center justify-center gap-2 text-[13px] text-[#5A6B85] dark:text-slate-400">
              <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
              Loading leads...
            </div>
          </div>
        )}

        {/* ── List / Table View (DataGrid) ─────────────────── */}
        {(activeView === 'list' || activeView === 'table') && !isColumnsLoading && (
          <LeadsDataGrid
            leads={paginatedLeads}
            totalRecords={sortedLeads.length}
            effectiveColumns={effectiveColumns}
            onRowClick={handleRowClick}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            getOwnerName={getOwnerName}
            getOwnerInitials={getOwnerInitials}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={(lead) => { setEditingLead(lead); setIsFormOpen(true); }}
            onDelete={(lead) => {
              if (!deleteLead) return;
              deleteLead(lead.id).then(() => {
                toast.success(`Lead deleted successfully`);
              }).catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : 'Failed to delete lead');
              });
            }}
            onConvert={(lead) => setConvertingLead(lead)}
            onMerge={(lead) => setMergingLead(lead)}
            onHideColumn={async (columnId) => {
              const updated = effectiveColumns.map((col) =>
                col.id === columnId ? { ...col, visible: false } : col,
              );
              try {
                await saveColumns(updated);
                toast.success('Column hidden');
              } catch {
                toast.error('Failed to hide column. Reverted.');
              }
            }}
            viewMode={viewMode}          />
        )}

        {/* ── Bottom Pagination + Per Page ─────────────────────── */}
        {(activeView === 'list' || activeView === 'table') && !isColumnsLoading && sortedLeads.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 mt-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Per page
              </label>
              <PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setCurrentPage(1); }} />
              <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">
                {sortedLeads.length} total records
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Page {currentPage} of {Math.ceil(sortedLeads.length / pageSize) || 1}
              </span>
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className={cn(
                  'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                  currentPage <= 1
                    ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
                )}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setCurrentPage(Math.min(Math.ceil(sortedLeads.length / pageSize), currentPage + 1))}
                disabled={currentPage >= Math.ceil(sortedLeads.length / pageSize)}
                className={cn(
                  'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                  currentPage >= Math.ceil(sortedLeads.length / pageSize)
                    ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
                )}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── Tile View ─────────────────────────────────────────── */}
        {activeView === 'tile' && (
          <LeadsTileView
            leads={filteredLeads}
            onCardClick={handleRowClick}
            getInitials={getInitials}
            getLeadName={getLeadName}
            getStatusVariant={getStatusVariant}
            formatCurrency={formatCurrency}
          />
        )}

        {/* ── Grid View ─────────────────────────────────────────── */}
        {activeView === 'grid' && (
          <LeadsGridView
            leads={filteredLeads}
            onCardClick={handleRowClick}
            getInitials={getInitials}
            getLeadName={getLeadName}
          />
        )}

        {/* ── Kanban View ───────────────────────────────────────── */}
        {activeView === 'kanban' && (
          <LeadsKanbanView
            leads={filteredLeads}
            onCardClick={handleRowClick}
            getInitials={getInitials}
            getLeadName={getLeadName}
            getStatusVariant={getStatusVariant}
          />
        )}
      </ModuleWorkspace>

      {/* ── Slide-Over Record Panel ─────────────────────────────────── */}
      <LeadPanel
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
        lead={selectedLead}
        onEdit={(lead) => {
          setEditingLead(lead);
          setIsFormOpen(true);
        }}
      />

      {/* ── Form Sheet ──────────────────────────────────────────── */}
      <LeadFormSheet
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingLead(undefined); }}
        initialData={editingLead}
        onSave={(data) => {
          if (editingLead) {
            updateLead(editingLead.id, data);
            toast.success('Lead updated');
          } else {
            addLead(data as any);
            toast.success('Lead created');
          }
          setIsFormOpen(false);
          setEditingLead(undefined);
        }}
      />

      {/* ── Import Leads — now a full-page experience at /crm/leads/import ─── */}

      {/* ── Convert Lead Dialog ─────────────────────────────────── */}
      {convertingLead && (
        <ConvertLeadDialog
          isOpen={!!convertingLead}
          onClose={() => setConvertingLead(null)}
          lead={convertingLead}
          onSuccess={() => setConvertingLead(null)}
        />
      )}

      {/* ── Merge Lead: Step 1 — Pick secondary record ───────────── */}
      {mergingLead && !mergeSecondaryId && (
        <SlidingDrawer
          isOpen={true}
          onClose={() => setMergingLead(null)}
          title="Merge Lead"
          subtitle={`Select a record to merge with ${mergingLead.firstName} ${mergingLead.lastName}`}
        >
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Select the duplicate lead to merge into the primary record.
            </p>
            <EntityCombobox
              entityType="leads"
              value={null}
              onChange={(id) => { if (id) setMergeSecondaryId(id); }}
              placeholder="Search for the duplicate lead..."
            />
          </div>
        </SlidingDrawer>
      )}

      {/* ── Merge Lead: Step 2 — Full comparison ─────────────────── */}
      {mergingLead && mergeSecondaryId && (
        <MergeRecordsDialog
          isOpen={true}
          onClose={() => { setMergingLead(null); setMergeSecondaryId(null); }}
          entityType="lead"
          primaryId={mergingLead.id}
          secondaryId={mergeSecondaryId}
          onSuccess={() => { setMergingLead(null); setMergeSecondaryId(null); }}
        />
      )}

      {/* ── Manage Columns Drawer ───────────────────────────────── */}
      <ManageColumnsDrawer
        isOpen={isManageColumnsOpen}
        onClose={() => setIsManageColumnsOpen(false)}
        module="leads"
        registry={LEADS_COLUMN_REGISTRY}
        effectiveColumns={effectiveColumns}
        onSave={saveColumns}
        onReset={resetColumns}
      />
    </>
  );
}
