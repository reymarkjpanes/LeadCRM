'use client';

import { useConfirmDialog } from '@/shared/hooks/use-confirm-dialog';
import { Button } from '@/shared/components/ui/button';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { Contact } from '@/store/types';
import { ModuleWorkspace, ViewType, StatusBadge, ContactPanel } from '@/shared/components/crm';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useColumnPreferences } from '@/shared/hooks/use-column-preferences';
import { useFilterUrlSync } from '@/shared/hooks/use-filter-url-sync';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useTablePreferences } from '@/shared/hooks/use-table-preferences';
import { ManageColumnsDrawer } from '@/shared/components/manage-columns-drawer';
import { CONTACTS_COLUMN_REGISTRY } from '@/shared/constants/column-registries';
import { CONTACTS_MODULE_CONFIG } from '../contacts.config';
import { ContactsDataGrid } from './contacts-data-grid';
import { ContactFormSheet } from './contact-form';
import { ColumnsPopover } from '@/shared/components/data-grid';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';
import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { useRouter } from 'next/navigation';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { CRM_STATUSES, normalizeCrmStatus, compareSortValues } from '@leadcrm/shared';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
// ── Contacts Page ─────────────────────────────────────────────────────────────
// Shows all contacts with activity flags, customer type, account links, deals

export default function ContactsPage(): React.ReactElement {
  const { organizations, deals, users } = useData();
  const { user, tenant } = useAuth();
  const { dialogProps, confirm, close } = useConfirmDialog();
  const canCreate = useHasPermission('contacts.create');
  const canImport = useHasPermission('contacts.import');
  const canEdit   = useHasPermission('contacts.edit');
  const canDelete = useHasPermission('contacts.archive');
  const { getParam, getArrayParam, updateParams } = useFilterUrlSync('contacts');

  const highlightId = getParam('highlight') || undefined;

  const { data: contacts = [], refetch: fetchContacts, error: contactsError, isInitialLoad, isRefreshing } = useCachedPage({
    module: 'contacts',
    revalidateOnInvalidation: true,
    params: { collection: 'all', recordId: highlightId },
    intervalMs: 60_000,
    fetchFn: async (signal) => {
      if (highlightId) return [(await contactsV2Api.get(highlightId, signal)).data];
      const rows: Contact[] = [];
      let page = 1;
      while (true) {
        const response = await contactsV2Api.list({ limit: 100, page }, signal);
        rows.push(...response.data);
        if (!response.meta.hasMore || response.data.length === 0) return rows;
        page++;
      }
    },
  });

  useEffect(() => {
    if (contactsError) toast.error(contactsError);
  }, [contactsError]);

  // ── Column Preferences ────────────────────────────────────────────────
  const {
    effectiveColumns,
    isLoading: isColumnsLoading,
    saveColumns,
    resetColumns,
  } = useColumnPreferences('contacts');

  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const manageColumnsButtonRef = useRef<HTMLButtonElement>(null);

  // ── Navigation ─────────────────────────────────────────────────────────
  const router = useRouter();

  // ── Form State ────────────────────────────────────────────────────────
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | undefined>(undefined);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // ── Table Preferences (pageSize, viewMode, sort) ──────────────────────
  const {
    pageSize,
    viewMode,
    sort,
    setPageSize,
    setViewMode,
    setSort,
    persistFilters,
  } = useTablePreferences('contacts');

  // ── State (Synced with URL) ──────────────────────────────────────────
  const [activeView, setActiveView] = useState<ViewType>(() => (getParam('view') as ViewType) || 'list');
  const [activeTab, setActiveTab] = useState(() => getParam('tab') || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => getParam('search'));
  const [filterSearchTerm, setFilterSearchTerm] = useState('');
  const [contactSelectedIds, setContactSelectedIds] = useState<Set<string>>(new Set());

  // Multi-select stacked criteria
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() => getArrayParam('status').map(normalizeCrmStatus));
  const [selectedSystemFilters, setSelectedSystemFilters] = useState<string[]>(() => getArrayParam('system'));
  const [selectedOwners, setSelectedOwners] = useState<string[]>(() => getArrayParam('owners'));
  const [selectedRelated, setSelectedRelated] = useState<string[]>(() => getArrayParam('related'));

  const debouncedSearch = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (!highlightId) return;
    setSearchTerm(''); setActiveTab('all'); setActiveView('table'); setCurrentPage(1);
    setSelectedSystemFilters([]);
    setSelectedStatuses([]);
    setSelectedOwners([]);
    setSelectedRelated([]);
  }, [highlightId]);

  // Sync to URL
  useEffect(() => {
    if (highlightId) return;
    updateParams({
      tab: activeTab !== 'all' ? activeTab : null,
      search: debouncedSearch || null,
      view: activeView !== 'list' ? activeView : null,
      status: selectedStatuses,
      system: selectedSystemFilters,
      types: null,
      owners: selectedOwners,
      related: selectedRelated,
    });
  }, [activeTab, debouncedSearch, activeView, selectedStatuses, selectedSystemFilters, selectedOwners, selectedRelated, highlightId, updateParams]);

  // ── Persist filter selections (fire-and-forget) ────────────────────────
  useEffect(() => {
    const conditions: { field: string; operator: string; value: unknown }[] = [];
    if (selectedStatuses.length) conditions.push({ field: 'status', operator: 'in', value: selectedStatuses });
    if (selectedSystemFilters.length > 0) {
      conditions.push({ field: 'system', operator: 'in', value: selectedSystemFilters });
    }
    if (selectedOwners.length > 0) {
      conditions.push({ field: 'assignedUserId', operator: 'in', value: selectedOwners });
    }
    if (selectedRelated.length > 0) {
      conditions.push({ field: 'related', operator: 'in', value: selectedRelated });
    }
    persistFilters(conditions);
  }, [selectedStatuses, selectedSystemFilters, selectedOwners, selectedRelated, persistFilters]);

  // ── Data ─────────────────────────────────────────────────────────────
  const activeContacts = useMemo(
    () => contacts.filter((c) => !c.isArchived),
    [contacts],
  );

  const activeCustomersCount = useMemo(
    () => activeContacts.filter((c) => c.customerType === 'Active Customer').length,
    [activeContacts],
  );

  const filteredContacts = useMemo(() => {
    if (highlightId) return activeContacts.filter(contact => contact.id === highlightId);
    let result = activeContacts;

    // Tab filter
    if (activeTab === 'my') {
      result = result.filter((c) => c.assignedUserId === user?.id);
    } else if (activeTab === 'active-customers') {
      result = result.filter((c) => c.customerType === 'Active Customer');
    }

    // Search query
    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      result = result.filter(
        (c) =>
          (c.contactPerson ?? c.leadPerson ?? '').toLowerCase().includes(term) ||
          (c.email ?? '').toLowerCase().includes(term) ||
          (c.companyName ?? '').toLowerCase().includes(term),
      );
    }

    if (selectedStatuses.length) result = result.filter(c => selectedStatuses.includes(normalizeCrmStatus(c.status)));

    // System Filters
    if (selectedSystemFilters.includes('touched')) {
      result = result.filter((c) => c.lastUpdated || c.updateStatus);
    }
    if (selectedSystemFilters.includes('untouched')) {
      result = result.filter((c) => !c.lastUpdated && !c.updateStatus);
    }

    // Owners
    if (selectedOwners.length > 0) {
      result = result.filter((c) => selectedOwners.includes(c.assignedUserId ?? ''));
    }

    // Related (e.g. Has Deals)
    if (selectedRelated.includes('has_deals')) {
      result = result.filter((c) => deals.some(d => !d.isArchived && (d.contactId === c.id || (d.contactIds ?? []).includes(c.id))));
    }

    return result;
  }, [activeContacts, activeTab, user?.id, debouncedSearch, selectedStatuses, selectedSystemFilters, selectedOwners, selectedRelated, deals, highlightId]);

  const getAccountName = useCallback((contact: Contact): string => {
    const linked = organizations.find(org => org.id === (contact.accountId ?? contact.organizationId));
    const apiContact = contact as Contact & { account?: { name: string }; company?: string };
    return linked?.name ?? contact.companyName ?? apiContact.account?.name ?? apiContact.company ?? '—';
  }, [organizations]);

  // ── Pagination ───────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter/search/tab/pageSize/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, activeTab, selectedStatuses, selectedSystemFilters, selectedOwners, selectedRelated, pageSize, sort]);

  const paginatedContacts = useMemo(() => {
    const start = highlightId ? 0 : (currentPage - 1) * pageSize;
    const value = (row: Contact) => {
      if (sort?.field === 'firstName') return row.firstName ?? row.contactPerson ?? row.leadPerson;
      if (sort?.field === 'companyName') {
        const company = getAccountName(row);
        return company === '—' ? null : company;
      }
      if (sort?.field === 'createdAt') return row.createdAt ? new Date(row.createdAt) : null;
      return (row as unknown as Record<string, unknown>)[sort?.field ?? ''];
    };
    const ordered = sort ? [...filteredContacts].sort((a, b) => compareSortValues(value(a), value(b), sort.direction)) : filteredContacts;
    return ordered.slice(start, start + pageSize);
  }, [filteredContacts, currentPage, pageSize, sort, getAccountName, highlightId]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const getInitials = (contact: Contact): string => {
    const name = contact.contactPerson ?? contact.leadPerson ?? contact.firstName ?? '';
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getName = (contact: Contact): string => {
    return contact.contactPerson ?? contact.leadPerson ?? (`${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown');
  };

  const getSubtitle = (contact: Contact): string => {
    return contact.jobTitle ?? '';
  };

  const getCustomerType = (contact: Contact): string => {
    return contact.customerType ?? 'Prospect';
  };

  const getCustomerTypeVariant = (type: string): 'success' | 'info' | 'purple' | 'neutral' => {
    if (type === 'Active Customer') return 'success';
    if (type === 'Prospect') return 'info';
    if (type === 'Evaluator') return 'purple';
    return 'neutral';
  };



  const getContactDeals = (contactId: string): number => {
    return deals.filter((d) =>
      !d.isArchived && (d.contactId === contactId || (d.contactIds ?? []).includes(contactId)),
    ).length;
  };

  const getContactValue = (contactId: string): number => {
    return deals
      .filter((d) => !d.isArchived && (d.contactId === contactId || (d.contactIds ?? []).includes(contactId)))
      .reduce((sum, d) => sum + (d.value ?? 0), 0);
  };

  // Activity flag helper - shows date when there's a recent task/activity
  const getActivityDate = (contact: Contact): string | null => {
    const created = contact.createdAt ? new Date(contact.createdAt) : null;
    if (!created) return null;
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 3600 * 24));
    if (diffDays <= 14) {
      return `${created.toLocaleDateString('en-US', { month: 'short' })} ${created.getDate()}`;
    }
    return null;
  };

  // ── Filter Groups ────────────────────────────────────────────────────
  const touchedCount = activeContacts.filter((c) => c.lastUpdated || c.updateStatus).length;
  const untouchedCount = activeContacts.length - touchedCount;

  const filterGroups = useMemo(() => [
    {
      id: 'status', label: 'Status', isExpanded: true,
      items: CRM_STATUSES.map(status => ({ id: status, label: status, count: activeContacts.filter(c => normalizeCrmStatus(c.status) === status).length, isChecked: selectedStatuses.includes(status) })),
    },
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
        ...users.slice(0, 5).map(u => ({
          id: `owner:${u.id}`,
          label: `Assigned Agent: ${u.firstName} ${u.lastName}`,
          count: activeContacts.filter(c => c.assignedUserId === u.id).length,
          isChecked: selectedOwners.includes(u.id),
        })),
      ],
    },
    {
      id: 'related',
      label: 'Filter By Related Modules',
      isExpanded: true,
      items: [
        { id: 'has_deals', label: 'Contacts with Deals', count: activeContacts.filter(c => deals.some(d => !d.isArchived && (d.contactId === c.id || (d.contactIds ?? []).includes(c.id)))).length, isChecked: selectedRelated.includes('has_deals') },
      ],
    },
  ], [activeContacts, touchedCount, untouchedCount, selectedStatuses, selectedSystemFilters, selectedOwners, selectedRelated, users, deals]);

  const handleFilterToggle = useCallback((groupId: string, itemId: string) => {
    if (groupId === 'status') {
      setSelectedStatuses(prev => prev.includes(itemId) ? prev.filter(value => value !== itemId) : [...prev, itemId]);
    } else if (groupId === 'system') {
      setSelectedSystemFilters(prev =>
        prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]
      );
    } else if (groupId === 'fields') {
      if (itemId.startsWith('owner:')) {
        const ownerId = itemId.replace('owner:', '');
        setSelectedOwners(prev =>
          prev.includes(ownerId) ? prev.filter(x => x !== ownerId) : [...prev, ownerId]
        );
      }
    } else if (groupId === 'related') {
      setSelectedRelated(prev =>
        prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]
      );
    }
  }, []);

  const confirmArchive = (ids: string[], name: string) => confirm({
    title: 'Archive Contact' + (ids.length > 1 ? 's?' : '?'),
    description: `${name} will be removed from active Contacts and moved to Archived Data. You can restore this record later.`,
    confirmLabel: 'Archive',
    onConfirm: async () => {
      try {
        await Promise.all(ids.map((id) => contactsV2Api.archive(id)));
        await fetchContacts();
        setContactSelectedIds(new Set());
        close();
        toast.success('Contact archived');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to archive contact');
      }
    },
  });

  return (
    <>
    <ConfirmActionDialog {...dialogProps} />
      <ModuleWorkspace
      bulkSelection={{ count: contactSelectedIds.size, onClear: () => setContactSelectedIds(new Set()), actions: canDelete && <Button variant="outline" onClick={() => confirmArchive([...contactSelectedIds], `${contactSelectedIds.size} contacts`)}>Archive</Button> }}
      moduleId="contacts"
      title="Contacts"
      moduleConfig={CONTACTS_MODULE_CONFIG}
      primaryActionLabel="Create Contact"
      onPrimaryAction={() => { setEditingContact(undefined); setIsFormOpen(true); }}
      onImport={canImport ? () => router.push('/crm/contacts/import') : undefined}
      canCreate={canCreate}
      availableViews={['table']}
      activeView={'table' as ViewType}
      onViewChange={setActiveView}

      pageSize={pageSize}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      savedTabs={[
        { id: 'all', label: 'All Contacts' },
        { id: 'my', label: 'My Contacts' },
        { id: 'active-customers', label: 'Active Contacts' },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      filterGroups={filterGroups}
      onFilterToggle={handleFilterToggle}
      showFilters={showFilters}
      onToggleFilters={() => setShowFilters(!showFilters)}
      filterSearchTerm={filterSearchTerm}
      onFilterSearch={setFilterSearchTerm}
      totalRecords={filteredContacts.length}
      searchTerm={searchTerm}
      onSearch={setSearchTerm}
      searchPlaceholder="Search contacts..."
      onRefresh={fetchContacts}
      refreshDisabled={isInitialLoad || isRefreshing}
      loading={isInitialLoad || isRefreshing || isColumnsLoading}
      loadingLabel={isInitialLoad || isRefreshing ? 'Loading contacts...' : 'Loading columns...'}
      onManageColumns={() => setIsManageColumnsOpen(true)}
    >
        {highlightId && <div className="mb-3 flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>Showing selected search result</span>
          <button className="text-blue-600 underline" onClick={() => updateParams({ highlight: null, search: null })}>Show all records</button>
        </div>}
      {/* ── List / Table View — DataGrid ─────────────────── */}
      {(activeView === 'list' || activeView === 'table') && (
        <>
          {filteredContacts.length === 0 && (
            <ActionableEmptyState
              icon={Users}
              title={debouncedSearch ? 'No contacts match your search' : 'No contacts yet'}
              description={
                debouncedSearch
                  ? `Try a different search term or clear your filters.`
                  : 'Add your first contact to start building your CRM.'
              }
              actionLabel={!debouncedSearch && canCreate ? 'Add Contact' : undefined}
              onAction={!debouncedSearch && canCreate ? () => { setEditingContact(undefined); setIsFormOpen(true); } : undefined}
            />
          )}
          {filteredContacts.length > 0 && (
        <ContactsDataGrid
            sort={sort}
            onSortChange={setSort}
          contacts={paginatedContacts}
          totalRecords={filteredContacts.length}
          effectiveColumns={effectiveColumns}
          onRowClick={(contact) => setSelectedContact(contact)}
          selectedIds={contactSelectedIds}
          onSelectionChange={setContactSelectedIds}
          getAccountName={getAccountName}
          getAssignedUserName={(userId) => {
            if (!userId) return '—';
            const u = users.find((usr) => usr.id === userId);
            return u ? `${u.firstName} ${u.lastName}` : '—';
          }}
          canEdit={canEdit}
          canArchive={canDelete}
          onEdit={(contact) => { setEditingContact(contact); setIsFormOpen(true); }}
          onArchive={(contact) => confirmArchive([contact.id], getName(contact))}
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
          highlightRowId={highlightId}
          viewMode={viewMode}
        />
          )}
        </>
      )}

      {/* ── Bottom Pagination + Per Page ─────────────────────── */}
      {(activeView === 'list' || activeView === 'table') && filteredContacts.length > 0 && (
        <LeadsPagination currentPage={currentPage} totalRecords={filteredContacts.length} pageSize={pageSize} onPageChange={setCurrentPage} onPageSizeChange={size => { setPageSize(size); setCurrentPage(1); }} />
      )}

      {/* ── Tile View ─────────────────────────────────────────── */}
      {activeView === 'tile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredContacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => setSelectedContact(contact)}
              className="bg-white dark:bg-slate-800/60 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-[#2563EB]/30 transition-all"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-[11px] shrink-0">
                  {getInitials(contact)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate">
                    {getName(contact)}
                  </p>
                  <p className="text-[11.5px] text-[#2563EB] dark:text-blue-400 truncate font-medium">
                    {getAccountName(contact)}
                  </p>
                  <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate mt-0.5">
                    {contact.email ?? ''}
                  </p>
                </div>
                <StatusBadge label={getCustomerType(contact)} variant={getCustomerTypeVariant(getCustomerType(contact))} dot={false} />
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-[#E4E9F0] dark:border-slate-700">
                <span className="text-[12px] text-[#5A6B85]">
                  {getContactDeals(contact.id)} open · {formatCurrency(getContactValue(contact.id))}
                </span>
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-500 dark:text-slate-300">
                  {getInitials(contact).slice(0, 1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Grid View ─────────────────────────────────────────── */}
      {activeView === 'grid' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {filteredContacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => setSelectedContact(contact)}
              className="bg-white dark:bg-slate-800/60 border border-[#E4E9F0] dark:border-slate-700 rounded-xl p-3 cursor-pointer hover:shadow-md transition-all flex items-center gap-2.5"
            >
              <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0">
                {getInitials(contact)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[#0F172A] dark:text-white truncate">
                  {getName(contact)}
                </p>
                <p className="text-[10.5px] text-[#5A6B85] dark:text-slate-400 truncate">
                  {getAccountName(contact)}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-[#2563EB] bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded-md">
                {getContactDeals(contact.id)} deals
              </span>
            </div>
          ))}
        </div>
      )}
    </ModuleWorkspace>

    {/* ── Contact Slide-Over Panel ─────────────────────────────── */}
    <ContactPanel
      open={!!selectedContact}
      onOpenChange={(open) => !open && setSelectedContact(null)}
      contact={selectedContact}
      onEdit={(c) => {
        setEditingContact(c);
        setIsFormOpen(true);
      }}
    />

    {/* ── Contact Form Sheet ──────────────────────────────────── */}
    <ContactFormSheet
      isOpen={isFormOpen}
      onClose={() => { setIsFormOpen(false); setEditingContact(undefined); }}
      initialData={editingContact}
      onSave={async (data) => {
        try {
          if (editingContact) {
            await contactsV2Api.update(editingContact.id, data);
            toast.success('Contact updated successfully');
          } else {
            await contactsV2Api.create(data);
            toast.success('Contact created successfully');
          }
          await fetchContacts();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Failed to save contact');
        }
        setIsFormOpen(false);
        setEditingContact(undefined);
      }}
    />

    {/* ── Manage Columns Drawer ───────────────────────────────── */}
    <ManageColumnsDrawer
      isOpen={isManageColumnsOpen}
      onClose={() => setIsManageColumnsOpen(false)}
      module="contacts"
      registry={CONTACTS_COLUMN_REGISTRY}
      effectiveColumns={effectiveColumns}
      onSave={saveColumns}
      onReset={resetColumns}
      triggerRef={manageColumnsButtonRef}
    />

    </>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `$${value.toLocaleString()}`;
}
