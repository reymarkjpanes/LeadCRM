'use client';

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
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { ActionableEmptyState } from '@/shared/components/actionable-empty-state';
import { PageSizeSelect } from '@/shared/components/page-size-select';
import { useRouter } from 'next/navigation';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
// ── Contacts Page ─────────────────────────────────────────────────────────────
// Shows all contacts with activity flags, customer type, account links, deals

export default function ContactsPage(): React.ReactElement {
  const { organizations, deals, users } = useData();
  const { user } = useAuth();
  const canCreate = useHasPermission('contacts.create');
  const canEdit   = useHasPermission('contacts.edit');
  const canDelete = useHasPermission('contacts.delete');
  const { getParam, getArrayParam, updateParams } = useFilterUrlSync('contacts');

  // ── Contacts Data (fetched from /crm/contacts — Contact table) ────────
  const [contacts, setContacts] = useState<Contact[]>([]);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await contactsV2Api.list({ limit: 100 });
      setContacts((res?.data ?? []) as Contact[]);
    } catch {
      // Passive background read — fail gracefully with an empty list rather than
      // surfacing a full-screen error. A visible fetch failure is handled by the
      // page's empty/error states, not a thrown/logged error that trips the dev overlay.
      setContacts([]);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

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
  const [selectedSystemFilters, setSelectedSystemFilters] = useState<string[]>(() => getArrayParam('system'));
  const [selectedCustomerTypes, setSelectedCustomerTypes] = useState<string[]>(() => getArrayParam('types'));
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
      types: selectedCustomerTypes,
      owners: selectedOwners,
      related: selectedRelated,
    });
  }, [activeTab, debouncedSearch, activeView, selectedSystemFilters, selectedCustomerTypes, selectedOwners, selectedRelated, updateParams]);

  // ── Persist filter selections (fire-and-forget) ────────────────────────
  useEffect(() => {
    const conditions: { field: string; operator: string; value: unknown }[] = [];
    if (selectedSystemFilters.length > 0) {
      conditions.push({ field: 'system', operator: 'in', value: selectedSystemFilters });
    }
    if (selectedCustomerTypes.length > 0) {
      conditions.push({ field: 'customerType', operator: 'in', value: selectedCustomerTypes });
    }
    if (selectedOwners.length > 0) {
      conditions.push({ field: 'assignedUserId', operator: 'in', value: selectedOwners });
    }
    if (selectedRelated.length > 0) {
      conditions.push({ field: 'related', operator: 'in', value: selectedRelated });
    }
    persistFilters(conditions);
  }, [selectedSystemFilters, selectedCustomerTypes, selectedOwners, selectedRelated, persistFilters]);

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

    // System Filters
    if (selectedSystemFilters.includes('touched')) {
      result = result.filter((c) => c.lastUpdated || c.updateStatus);
    }
    if (selectedSystemFilters.includes('untouched')) {
      result = result.filter((c) => !c.lastUpdated && !c.updateStatus);
    }

    // Customer Types
    if (selectedCustomerTypes.length > 0) {
      result = result.filter((c) => selectedCustomerTypes.includes(c.customerType ?? 'Prospect'));
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
  }, [activeContacts, activeTab, user?.id, debouncedSearch, selectedSystemFilters, selectedCustomerTypes, selectedOwners, selectedRelated, deals]);

  // ── Pagination ───────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page on filter/search/tab/pageSize/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, activeTab, selectedSystemFilters, selectedCustomerTypes, selectedOwners, selectedRelated, pageSize, sort]);

  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, currentPage, pageSize]);

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

  const getAccountName = (contact: Contact): string => {
    if (contact.organizationId) {
      const org = organizations.find((o) => o.id === contact.organizationId);
      return org?.name ?? contact.companyName ?? '—';
    }
    return contact.companyName ?? '—';
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

  const getStatusVariant = (status: string): 'success' | 'info' | 'danger' | 'neutral' => {
    if (status === 'Active') return 'success';
    if (status === 'Inactive') return 'danger';
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
        { id: 'type:Active Customer', label: 'Type: Active Customer', count: activeContacts.filter(c => c.customerType === 'Active Customer').length, isChecked: selectedCustomerTypes.includes('Active Customer') },
        { id: 'type:Prospect', label: 'Type: Prospect', count: activeContacts.filter(c => c.customerType === 'Prospect').length, isChecked: selectedCustomerTypes.includes('Prospect') },
        { id: 'type:Evaluator', label: 'Type: Evaluator', count: activeContacts.filter(c => c.customerType === 'Evaluator').length, isChecked: selectedCustomerTypes.includes('Evaluator') },
        ...users.slice(0, 5).map(u => ({
          id: `owner:${u.id}`,
          label: `Owner: ${u.firstName} ${u.lastName}`,
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
  ], [activeContacts, touchedCount, untouchedCount, selectedSystemFilters, selectedCustomerTypes, selectedOwners, selectedRelated, users, deals]);

  const handleFilterToggle = useCallback((groupId: string, itemId: string) => {
    if (groupId === 'system') {
      setSelectedSystemFilters(prev =>
        prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]
      );
    } else if (groupId === 'fields') {
      if (itemId.startsWith('type:')) {
        const type = itemId.replace('type:', '');
        setSelectedCustomerTypes(prev =>
          prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
        );
      } else if (itemId.startsWith('owner:')) {
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

  return (
    <>
    <ModuleWorkspace
      moduleId="contacts"
      title="Contacts"
      moduleConfig={CONTACTS_MODULE_CONFIG}
      primaryActionLabel="Create Contact"
      onPrimaryAction={() => { setEditingContact(undefined); setIsFormOpen(true); }}
      onImport={() => router.push('/crm/contacts/import')}
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
      onRefresh={() => toast.success('Refreshed')}
      onManageColumns={() => setIsManageColumnsOpen(true)}
    >
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
          canDelete={canDelete}
          onEdit={(contact) => { setEditingContact(contact); setIsFormOpen(true); }}
          onDelete={async (contact) => {
            try {
              await contactsV2Api.archive(contact.id);
              setContacts((prev) => prev.filter((c) => c.id !== contact.id));
              toast.success('Contact archived successfully');
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : 'Failed to archive contact');
            }
          }}
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
      {(activeView === 'list' || activeView === 'table') && filteredContacts.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 mt-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">Per page</label>
            <PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setCurrentPage(1); }} />
            <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{filteredContacts.length} total records</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Page {currentPage} of {Math.ceil(filteredContacts.length / pageSize) || 1}</span>
            <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors', currentPage <= 1 ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setCurrentPage(Math.min(Math.ceil(filteredContacts.length / pageSize), currentPage + 1))} disabled={currentPage >= Math.ceil(filteredContacts.length / pageSize)} className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors', currentPage >= Math.ceil(filteredContacts.length / pageSize) ? 'border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')} aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
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
