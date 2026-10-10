'use client';
import type { DeactivationImpact } from '@leadcrm/shared';
import { AssignedAgentSelect } from '@/shared/components/crm/assigned-agent-select';
import { CreateButton } from '@/shared/components/ui/button';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { compareSortValues } from '@leadcrm/shared';
import {
  Plus, UserCheck, UserX,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { usePagination } from '@/shared/hooks/use-pagination';
import { LeadsPagination, LEADS_PAGE_SIZES } from '@/shared/components/crm/leads-pagination';
import { ModuleFilterRail } from '@/shared/components/crm/module-filter-rail';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { usersService } from '@/features/tenant/administration/users/services/users.service';
import { DataGrid, type DataGridColumnDef, type SortState } from '@/shared/components/data-grid';
import { BulkSelectionBar, executeSelectedRows } from '@/shared/components/crm/bulk-selection-bar';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { useModuleTableColumns } from '@/shared/hooks/use-module-table-columns';
import { USERS_TABLE_COLUMNS } from '@leadcrm/shared';
import { UserPanel } from './user-panel';
import { UserAvatar as ProfileAvatar } from '@/shared/components/user-avatar';
import { DataErrorState } from '@/shared/components/crm/data-view-states';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { cn } from '@/lib/utils';
import type { User } from '@/store/types';

// ── Avatar ─────────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 8 }: { user: User; size?: number }): React.ReactElement {
  const px = size * 4;
  // Private profile images are read through the tenant's users permission guard.
  const avatarUrl = user.avatarUrl?.startsWith('/api/proxy/auth/profile/avatar/')
    ? user.avatarUrl.replace('/api/proxy/auth/profile/avatar/', `/api/proxy/administration/users/${encodeURIComponent(user.id)}/avatar/`)
    : user.avatarUrl;
  return (
    <div style={{ width: px, height: px, minWidth: px }}
      className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 text-[10px]">
      <ProfileAvatar user={{ ...user, avatarUrl }} />
    </div>
  );
}

// ── Role colour helper ──────────────────────────────────────────────────────

function roleColor(role: string): string {
  if (role === 'Administrator' || role === 'Client Admin') return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
  if (role === 'Sales Manager') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
  if (role === 'Support Agent' || role === 'Technician') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
  if (role === 'Marketing Manager') return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
  if (role === 'Viewer') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20';
}

// ── Main UsersSubTab ──────────────────────────────────────────────────────────

export function UsersSubTab({ onUsersLoaded, renderHeader }: { renderHeader?: (action: React.ReactNode) => React.ReactNode; onUsersLoaded?: (users: User[]) => void }): React.ReactElement {
  const { user: currentUser, userCan } = useAuth();
  const { roles, rolesLoading, rolesError, refreshRoles } = useData();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const tenantId = currentUser?.tenantId ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(null);
    const load = async () => {
      try {
        const result: User[] = [];
        let page = 1;
        while (!cancelled) {
          const response = await usersService.getAll({ page, limit: 100 });
          result.push(...(response.data ?? []));
          if (!response.meta?.hasMore) break;
          page++;
        }
        if (!cancelled) {
          setAllUsers(result);
          setEditingUser(previous => previous ? result.find(user => user.id === previous.id) ?? null : null);
          onUsersLoaded?.(result);
        }
      } catch (error) { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load users.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    if (tenantId) void load();
    return () => { cancelled = true; };
  }, [tenantId, reload, onUsersLoaded]);

  const tenantUsers = useMemo(
    () => allUsers.filter((u) => u.tenantId === tenantId),
    [allUsers, tenantId],
  );
  const roleNames = useMemo(() => roles.filter((r) => !r.isArchived).map((r) => r.name), [roles]);
  const roleObjs = useMemo(() => roles.filter((r) => !r.isArchived && !r.isSystemRole).map((r) => ({ id: r.id, name: r.name })), [roles]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ field: 'createdAt', direction: 'desc' });
  const [showFilters, setShowFilters] = useState(false);
  const groups = useMemo(() => [...new Map(tenantUsers.flatMap(user => user.groups ?? []).map(group => [group.id, group])).values()].sort((a, b) => a.name.localeCompare(b.name)), [tenantUsers]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [initiallyEditing, setInitiallyEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingUser, setEditingUser] = useState<User | null>(null);
  useEffect(() => { setEditingUser(null); setIsAddOpen(false); }, [tenantId]);
  useEffect(() => { const changed = () => setReload(value => value + 1); window.addEventListener('leadcrm:groups-changed', changed); return () => window.removeEventListener('leadcrm:groups-changed', changed); }, []);
  const [confirmArchive, setConfirmArchive] = useState<User | null>(null);
  const [statusChangeUser, setStatusChangeUser] = useState<User | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [impact, setImpact] = useState<DeactivationImpact | null>(null);
  const [replacement, setReplacement] = useState('');
  const [reassignUser, setReassignUser] = useState<User | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const beginStatusChange = async (target: User) => {
    if (preflighting) return;
    if (target.status === 'active' && currentUser?.role !== 'Client Admin') return;
    setReplacement(''); setImpact(null);
    if (target.status !== 'active') { setStatusChangeUser(target); return; }
    setPreflighting(true);
    try {
      const result = await usersService.deactivationImpact(target.id);
      if (!result.data) throw new Error('Unable to check assigned records and unfinished tasks.');
      setImpact(result.data); setReassignUser(target);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to check CRM ownership.'); }
    finally { setPreflighting(false); }
  };

  const filtered = useMemo(() => {
    return tenantUsers.filter((u) => {
      const matchSearch = !search || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter.length === 0 || roleFilter.includes(u.role);
      const matchStatus = statusFilter.length === 0 || statusFilter.some((s) => s.toLowerCase() === (u.status ?? '').toLowerCase());
      return matchSearch && matchRole && matchStatus && (groupFilter.length === 0 || u.groups?.some(group => groupFilter.includes(group.id)));
    }).sort((a, b) => {
      const value = (u: User) => sort.field === 'name' ? `${u.firstName} ${u.lastName}` : sort.field === 'groups' ? u.groups?.map(group => group.name).join(', ') : sort.field === 'createdAt' ? u.createdAt ? new Date(u.createdAt) : null : u[sort.field as keyof User];
      return compareSortValues(value(a), value(b), sort.direction) || a.id.localeCompare(b.id);
    });
  }, [tenantUsers, search, roleFilter, statusFilter, groupFilter, sort]);

  const { currentPage, pageSize, totalItems, paginateItems, goToPage, setPageSize } = usePagination({
    totalItems: filtered.length,
    initialPageSize: 25,
    pageSizeOptions: LEADS_PAGE_SIZES,
    resetDeps: [search, roleFilter, statusFilter, groupFilter, sort],
  });
  const paginated = paginateItems(filtered);
  useEffect(() => { setSelected(new Set()); }, [tenantId, currentPage, pageSize, search, roleFilter, statusFilter, groupFilter]);
  const openUser = (user: User, edit = false) => { setInitiallyEditing(edit); setEditingUser(user); };

  const handleSavedUser = (saved: User, refresh = true) => {
    setAllUsers(previous => previous.some(user => user.id === saved.id) ? previous.map(user => user.id === saved.id ? saved : user) : [saved, ...previous]);
    setEditingUser(previous => previous?.id === saved.id ? saved : previous);
    if (refresh) setReload(value => value + 1);
  };
  const [archiving, setArchiving] = useState(false);
  const handleArchive = async () => {
    if (!confirmArchive || archiving) return;
    setArchiving(true);
    try {
      await usersService.archive(confirmArchive.id);
      setConfirmArchive(null); setSelected(new Set()); setReload(value => value + 1);
      toast.success('User archived');
    } catch (error) { throw new Error(error instanceof Error ? error.message : 'Unable to archive user.'); }
    finally { setArchiving(false); }
  };

  const handleStatusChange = async () => {
    if (!statusChangeUser || changingStatus) return;
    const nextStatus = statusChangeUser.status === 'active' ? 'inactive' : 'active';
    setChangingStatus(true);
    try {
      if (nextStatus === 'inactive') {
        const result = await usersService.deactivate(statusChangeUser.id, replacement || null);
        handleSavedUser(result.user, false);
        toast.success(result.impact.total ? 'Records and unfinished tasks transferred successfully and user deactivated.' : 'User deactivated successfully.');
      } else {
        const result = await usersService.update(statusChangeUser.id, { status: nextStatus });
        if (!result.data) throw new Error('Unable to update user status.');
        handleSavedUser(result.data, false);
        window.dispatchEvent(new Event('leadcrm:users-changed'));
        toast.success('User activated.');
      }
      setStatusChangeUser(null); setReassignUser(null); setImpact(null); setReplacement('');
      return false;
    } catch (error) {
      if (nextStatus === 'inactive') {
        setReload(value => value + 1);
        try {
          const refreshed = await usersService.deactivationImpact(statusChangeUser.id);
          if (refreshed.data) setImpact(refreshed.data);
        } catch { /* Keep the last known counts and allow cancellation back to reassignment. */ }
      }
      throw new Error(error instanceof Error ? error.message : 'Unable to update the account. Review the assigned agent and try again.');
    } finally {
      setChangingStatus(false);
    }
  };

  const canAssignRoles = userCan('roles', 'canAssign');
  const canManageUsers = userCan('users', 'canEdit'), canCreateUsers = userCan('users', 'canCreate') && userCan('roles', 'canAssign'), canActivateUsers = userCan('users', 'canActivate'), canArchiveUsers = userCan('users', 'canArchive');
  const canDeactivateUsers = canActivateUsers && currentUser?.role === 'Client Admin';
  const columns: DataGridColumnDef<User>[] = [
    { id: 'name', sortable: true, header: 'User', accessor: u => `${u.firstName} ${u.lastName}`, width: 240, cell: (_, u) => <button aria-label={`View ${u.firstName} ${u.lastName}`} onClick={() => openUser(u)} className="flex items-center gap-2 text-left"><UserAvatar user={u} /><span>{u.firstName} {u.lastName}</span></button> },
    { id: 'role', sortable: true, header: 'Role', accessor: u => u.role, width: 180, cell: (_, u) => <span className={cn('rounded-full border px-2 py-0.5 text-xs', roleColor(u.role))}>{u.role}</span> },
    { id: 'email', sortable: true, header: 'Contact', accessor: u => u.email, width: 250, cell: (_, u) => <div><p>{u.email}</p><p className="text-xs text-muted-foreground">{u.phone}</p></div> },
    { id: 'status', sortable: true, header: 'Status', accessor: u => u.status ?? 'active', width: 110, cell: (_, u) => <span className={cn('rounded-full px-2 py-1 text-xs', u.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500')}>{u.status ?? 'active'}</span> },
    { id: 'groups', sortable: true, header: 'Groups', accessor: u => u.groups?.map(group => group.name).join(', ') || '—', width: 180 },
    { id: 'activity', header: 'Actions', accessor: () => '', width: 90, cell: (_, u) => {
      const active = u.status === 'active';
      const label = active ? `Deactivate ${u.firstName} ${u.lastName}` : `Activate ${u.firstName} ${u.lastName}`;
      return <button type="button" aria-label={label} title={active && !canDeactivateUsers ? 'Client Admin is required to deactivate and reassign ownership' : active ? 'Deactivate user' : 'Activate user'} disabled={(active ? !canDeactivateUsers : !canActivateUsers) || preflighting} className="min-h-11 min-w-11 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void beginStatusChange(u)}>{active ? <UserX size={16} /> : <UserCheck size={16} />}</button>;
    } },
  ];

  const tableColumns = useModuleTableColumns('users', USERS_TABLE_COLUMNS, columns);
  const createAction = canCreateUsers && <CreateButton label="New User" disabled={rolesLoading || !!rolesError} onClick={() => setIsAddOpen(true)} />;

  return (
    <div className="min-w-0 max-w-full space-y-4">
      {renderHeader ? renderHeader(createAction) : <div className="flex justify-end">{createAction}</div>}
      {tableColumns.drawer}
      {rolesError && <div role="alert" className="text-sm text-red-500">{rolesError} <button onClick={() => void refreshRoles()} className="underline">Retry roles</button></div>}
      <ModuleTableToolbar label="Users" search={search} onSearch={setSearch} placeholder="Search users..."
        filter={<FilterButton title="users" open={showFilters} active={!!(roleFilter.length || statusFilter.length || groupFilter.length)} onClick={() => setShowFilters(value => !value)} />}
        refreshing={loading} onRefresh={() => setReload(value => value + 1)} onManageColumns={tableColumns.openColumns} />

      <div className="flex min-w-0 gap-3 items-stretch">
        <ModuleFilterRail label="User filters" showFilters={showFilters} onToggleFilters={() => setShowFilters(value => !value)} totalRecords={filtered.length}
          filterGroups={[
            { id: 'status', label: 'Status', items: ['active', 'inactive'].map(id => ({ id, label: id === 'active' ? 'Active' : 'Inactive', isChecked: statusFilter.includes(id) })) },
            { id: 'groups', label: 'Groups', items: groups.map(group => ({ id: group.id, label: group.name, isChecked: groupFilter.includes(group.id) })) },
            { id: 'role', label: 'Role', items: roleNames.map(id => ({ id, label: id, isChecked: roleFilter.includes(id) })) },
          ]}
          onFilterToggle={(group, id) => {
            const update = (previous: string[]) => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id];
            if (group === 'status') setStatusFilter(update);
            else if (group === 'groups') setGroupFilter(update);
            else if (group === 'role') setRoleFilter(update);
          }} />
        <div className="min-w-0 flex-1 space-y-4">
          {loading ? <TableLoadingState label="Loading users..." /> : loadError ? <DataErrorState message={loadError} onRetry={() => setReload(value => value + 1)} /> :
            <DataGrid<User> sort={sort} sortingMode="external" onSortChange={next => setSort(next ?? { field: 'createdAt', direction: 'desc' })} columns={tableColumns.columns} data={paginated} getRowId={row => row.id} height="auto" selectable={canArchiveUsers} selectedIds={selected} onSelectionChange={setSelected} enableColumnMenu={false} ariaLabel="Team Management table" emptyMessage="No users found"
              onRowClick={u => openUser(u)} rowActions={u => [
                { id: 'view', label: 'View', onClick: () => openUser(u) },
                ...((canManageUsers || canAssignRoles || canActivateUsers || canArchiveUsers) ? [
                  { id: 'edit', label: canManageUsers ? 'Edit' : 'Change access', disabled: !canManageUsers && !canAssignRoles && !canActivateUsers, onClick: () => openUser(u, true) },
                  { id: 'status', label: u.status === 'active' ? 'Deactivate' : 'Activate', disabled: u.status === 'active' ? !canDeactivateUsers : !canActivateUsers, onClick: () => void beginStatusChange(u) },
                  { id: 'archive', label: 'Archive', disabled: !!u.isArchived || !canArchiveUsers, onClick: () => setConfirmArchive(u) },
                ] : []),
              ]} />}
          <BulkSelectionBar selectedCount={selected.size} selectedIds={selected} onClearSelection={() => setSelected(new Set())} onRemoveIds={ids => setSelected(previous => new Set([...previous].filter(id => !ids.includes(id))))}
            actions={canArchiveUsers ? [{ id: 'archive', label: 'Archive', entityName: 'user', destructive: true, onExecute: async ids => { const result = await executeSelectedRows(ids, usersService.archive); setReload(value => value + 1); return result; } }] : []} />

          {/* Pagination */}
          {!loading && !loadError && (
            <LeadsPagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={totalItems}
              onPageChange={goToPage}
              onPageSizeChange={setPageSize}
            />
          )}

        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {isAddOpen && (
          <UserPanel roles={roleObjs} canEdit={canCreateUsers} onSaved={handleSavedUser} onClose={() => setIsAddOpen(false)} />
        )}
        {editingUser && (
          <UserPanel key={`${editingUser.id}:${initiallyEditing}`} initiallyEditing={initiallyEditing} user={editingUser} roles={roleObjs} canEdit={canManageUsers} onSaved={handleSavedUser} onClose={() => setEditingUser(null)} />
        )}
      </AnimatePresence>
      <ConfirmActionDialog
        open={!!confirmArchive}
        onOpenChange={open => { if (!open) setConfirmArchive(null); }}
        title="Archive User?"
        description={`Archive ${confirmArchive?.firstName ?? ''} ${confirmArchive?.lastName ?? ''}? This deactivates their account. They will lose access until restored from Archived Data.`}
        variant="destructive"
        confirmLabel="Archive"
        confirmDisabled={!canArchiveUsers}
        isLoading={archiving}
        onConfirm={handleArchive}
      />
      <ConfirmActionDialog
        open={!!reassignUser && !statusChangeUser}
        onOpenChange={open => { if (!open) { setReassignUser(null); setImpact(null); setReplacement(''); } }}
        title="Reassign Records and Tasks"
        description={impact?.total ? `${reassignUser?.firstName} ${reassignUser?.lastName} has assigned records and unfinished tasks that must be reassigned before the account can be deactivated.` : 'No active records or unfinished tasks are assigned to this user.'}
        confirmLabel="Continue"
        confirmDisabled={!!impact?.total && !replacement}
        onConfirm={() => { setStatusChangeUser(reassignUser); return false; }}
      >
        <dl className="grid grid-cols-2 gap-2 text-sm">{Object.entries(impact?.counts ?? {}).map(([label, count]) => <React.Fragment key={label}><dt className="capitalize">{label}</dt><dd className="text-right">{count}</dd></React.Fragment>)}</dl>
        {!!impact?.total && <div className="space-y-2"><label htmlFor="deactivation-agent" className="text-sm font-medium">Assigned Agent <span className="text-red-500">*</span></label>
          <AssignedAgentSelect id="deactivation-agent" value={replacement} onChange={setReplacement} users={allUsers.filter(user => user.id !== reassignUser?.id)} placeholder="Select agent" className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 pr-8 text-sm" />
        </div>}
      </ConfirmActionDialog>
      <ConfirmActionDialog
        open={!!statusChangeUser}
        onOpenChange={(open) => { if (!open && !changingStatus) { setStatusChangeUser(null); setReassignUser(null); setReplacement(''); setImpact(null); } }}
        title={statusChangeUser?.status === 'active' ? 'Deactivate this user?' : 'Activate this user?'}
        description={statusChangeUser?.status === 'active'
          ? `Deactivate ${statusChangeUser.firstName} ${statusChangeUser.lastName}? ${impact?.total ? `${impact.counts.leads} Leads, ${impact.counts.contacts} Contacts, ${impact.counts.accounts} Accounts, and ${impact.counts.deals} Deals and ${impact.counts.tasks} unfinished Tasks will be reassigned to ${allUsers.find(user => user.id === replacement)?.firstName ?? ''} ${allUsers.find(user => user.id === replacement)?.lastName ?? ''}. ` : ''}They will lose access to this workspace.`
          : `Activate ${statusChangeUser?.firstName ?? ''} ${statusChangeUser?.lastName ?? ''}? They will regain access to this workspace.`}
        confirmLabel={statusChangeUser?.status === 'active' ? 'Deactivate' : 'Activate'}
        variant={statusChangeUser?.status === 'active' ? 'warning' : 'success'}
        confirmDisabled={(statusChangeUser?.status === 'active' ? !canDeactivateUsers : !canActivateUsers) || (statusChangeUser?.status === 'active' && !!impact?.total && !replacement)}
        isLoading={changingStatus}
        onConfirm={handleStatusChange}
      />
    </div>
  );
}
