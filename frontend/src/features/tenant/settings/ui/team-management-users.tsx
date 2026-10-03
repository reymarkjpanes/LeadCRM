'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { compareSortValues } from '@leadcrm/shared';
import {
  Search, Plus, X,
  ShieldAlert, CheckCircle2,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { usePagination } from '@/shared/hooks/use-pagination';
import { LeadsPagination, LEADS_PAGE_SIZES } from '@/shared/components/crm/leads-pagination';
import { auditApi } from '@/shared/services/audit.api';
import { FilterGroupSection } from '@/shared/components/crm/module-workspace';
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

// ── Timeline drawer ─────────────────────────────────────────────────────────

interface TimelineDrawerProps {
  selectedUser: User;
  onClose: () => void;
}

type AuditEntry = { id: string; userId?: string; userEmail?: string; action: string; details: string; timestamp: string; ipAddress?: string };

function TimelineDrawer({ selectedUser, onClose }: TimelineDrawerProps): React.ReactElement {
  const [filter, setFilter] = useState<'all' | 'auth' | 'edits' | 'permissions'>('all');
  const [search, setSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch audit logs for this user on open — on-demand, not at startup
  const fetchLogs = useCallback(async (): Promise<void> => {
    setIsLoadingLogs(true);
    setLoadError(null);
    try {
      const res = await auditApi.list({ limit: 100 });
      const all = (res?.data ?? []).map((entry) => ({
        id:        entry.id,
        userId:    entry.userId,
        userEmail: entry.user?.email,
        action:    entry.action,
        details:   entry.changeset
          ? JSON.stringify(entry.changeset)
          : (entry.metadata ? JSON.stringify(entry.metadata) : entry.action),
        timestamp: entry.createdAt,
        ipAddress: entry.ipAddress,
      })) as AuditEntry[];
      const uEmail = selectedUser.email?.toLowerCase() ?? '';
      const uName  = `${selectedUser.firstName ?? ''} ${selectedUser.lastName ?? ''}`.toLowerCase();
      const relevant = all.filter((log) => {
        const logEmail    = log.userEmail?.toLowerCase() ?? '';
        const detailsLow  = log.details?.toLowerCase() ?? '';
        return (
          log.userId === selectedUser.id ||
          (logEmail && logEmail === uEmail) ||
          (uName && detailsLow.includes(uName.trim())) ||
          (uEmail && detailsLow.includes(uEmail))
        );
      });
      setAuditLogs(relevant.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [selectedUser.id, selectedUser.email, selectedUser.firstName, selectedUser.lastName]);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  const filtered = useMemo(() => {
    let result = auditLogs;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((l) => l.action.toLowerCase().includes(q) || l.details.toLowerCase().includes(q));
    }
    if (filter !== 'all') {
      result = result.filter((l) => {
        const a = l.action.toLowerCase();
        if (filter === 'auth') return a.includes('auth') || a.includes('login') || a.includes('recovery');
        if (filter === 'edits') return a.includes('update') || a.includes('create') || a.includes('register') || a.includes('deal') || a.includes('contact');
        if (filter === 'permissions') return a.includes('role') || a.includes('permission') || a.includes('suspend') || a.includes('provision');
        return true;
      });
    }
    return result;
  }, [auditLogs, search, filter]);

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 280 }}
      className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-[#0f1923] border-l border-gray-200 dark:border-white/[0.07] shadow-2xl z-[60] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/[0.07] shrink-0">
        <div className="flex items-center gap-3">
          <UserAvatar user={selectedUser} size={10} />
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{selectedUser.firstName} {selectedUser.lastName}</p>
            <p className="text-[11px] text-slate-400">{selectedUser.email}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
      </div>
      {/* Filters */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.05] shrink-0 space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search activity..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors placeholder-slate-400" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(['all', 'auth', 'edits', 'permissions'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors cursor-pointer capitalize',
                filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-transparent text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-blue-400')}>
              {f}
            </button>
          ))}
        </div>
      </div>
      {/* Timeline */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
        {isLoadingLogs && (
          <div className="space-y-3 pt-2" role="status" aria-label="Loading activity">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0 motion-reduce:animate-none" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
                  <div className="h-2.5 w-1/2 bg-slate-100 dark:bg-slate-800 rounded animate-pulse motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoadingLogs && loadError && (
          <div className="py-12 text-center">
            <ShieldAlert size={28} className="text-red-400 mx-auto mb-2" />
            <p className="text-xs text-slate-400 mb-3">{loadError}</p>
            <button
              onClick={() => { void fetchLogs(); }}
              className="text-xs text-blue-500 hover:text-blue-600 underline underline-offset-2 cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}
        {!isLoadingLogs && !loadError && filtered.length === 0 && (
          <div className="py-16 text-center">
            <Clock size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-xs text-slate-400">No activity found</p>
          </div>
        )}
        {!isLoadingLogs && !loadError && filtered.map((log) => (
          <div key={log.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 size={12} className="text-blue-500" />
              </div>
              <div className="w-px flex-1 bg-slate-100 dark:bg-slate-800 mt-1" />
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">{log.action}</p>
                <span className="text-[10px] text-slate-400 shrink-0">{new Date(log.timestamp).toLocaleDateString()}</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{log.details}</p>
              {log.ipAddress && <p className="text-[10px] text-slate-400 mt-0.5">{log.ipAddress}</p>}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
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
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ field: 'createdAt', direction: 'desc' });
  const [showFilters, setShowFilters] = useState(false);
  const departments = useMemo(() => [...new Set(tenantUsers.map(u => u.department).filter((value): value is string => !!value?.trim()))].sort(), [tenantUsers]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [initiallyEditing, setInitiallyEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingUser, setEditingUser] = useState<User | null>(null);
  useEffect(() => { setEditingUser(null); setIsAddOpen(false); }, [tenantId]);
  const [timelineUser, setTimelineUser] = useState<User | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<User | null>(null);

  const filtered = useMemo(() => {
    return tenantUsers.filter((u) => {
      // The user API represents archived users with INACTIVE status. Include
      // those rows only when the administrator explicitly filters for Inactive.
      if (u.isArchived && !statusFilter.includes('inactive')) return false;
      const matchSearch = !search || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter.length === 0 || roleFilter.includes(u.role);
      const matchStatus = statusFilter.length === 0 || statusFilter.some((s) => s.toLowerCase() === (u.status ?? '').toLowerCase());
      return matchSearch && matchRole && matchStatus && (departmentFilter.length === 0 || departmentFilter.includes(u.department ?? ''));
    }).sort((a, b) => {
      const value = (u: User) => sort.field === 'name' ? `${u.firstName} ${u.lastName}` : sort.field === 'createdAt' ? u.createdAt ? new Date(u.createdAt) : null : u[sort.field as keyof User];
      return compareSortValues(value(a), value(b), sort.direction) || a.id.localeCompare(b.id);
    });
  }, [tenantUsers, search, roleFilter, statusFilter, departmentFilter, sort]);

  const { currentPage, pageSize, totalItems, paginateItems, goToPage, setPageSize } = usePagination({
    totalItems: filtered.length,
    initialPageSize: 25,
    pageSizeOptions: LEADS_PAGE_SIZES,
    resetDeps: [search, roleFilter, statusFilter, departmentFilter, sort],
  });
  const paginated = paginateItems(filtered);
  useEffect(() => { setSelected(new Set()); }, [tenantId, currentPage, pageSize, search, roleFilter, statusFilter, departmentFilter]);
  const openUser = (user: User, edit = false) => { setInitiallyEditing(edit); setEditingUser(user); };

  const handleSavedUser = (saved: User) => {
    setAllUsers(previous => previous.some(user => user.id === saved.id) ? previous.map(user => user.id === saved.id ? saved : user) : [saved, ...previous]);
    setReload(value => value + 1);
  };
  const [archiving, setArchiving] = useState(false);
  const handleArchive = async () => {
    if (!confirmArchive || archiving) return;
    setArchiving(true);
    try {
      await usersService.archive(confirmArchive.id);
      setConfirmArchive(null); setSelected(new Set()); setReload(value => value + 1);
      toast.success('User archived');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to archive user.'); }
    finally { setArchiving(false); }
  };

  const canAssignRoles = userCan('roles', 'canAssign');
  const canManageUsers = userCan('users', 'canEdit'), canCreateUsers = userCan('users', 'canCreate') && userCan('roles', 'canAssign'), canActivateUsers = userCan('users', 'canActivate'), canArchiveUsers = userCan('users', 'canArchive');
  const columns: DataGridColumnDef<User>[] = [
    { id: 'name', sortable: true, header: 'User', accessor: u => `${u.firstName} ${u.lastName}`, width: 240, cell: (_, u) => <button aria-label={`View ${u.firstName} ${u.lastName}`} onClick={() => openUser(u)} className="flex items-center gap-2 text-left"><UserAvatar user={u} /><span>{u.firstName} {u.lastName}</span></button> },
    { id: 'role', sortable: true, header: 'Role', accessor: u => u.role, width: 180, cell: (_, u) => <span className={cn('rounded-full border px-2 py-0.5 text-xs', roleColor(u.role))}>{u.role}</span> },
    { id: 'email', sortable: true, header: 'Contact', accessor: u => u.email, width: 250, cell: (_, u) => <div><p>{u.email}</p><p className="text-xs text-muted-foreground">{u.phone}</p></div> },
    { id: 'status', sortable: true, header: 'Status', accessor: u => u.status ?? 'active', width: 110, cell: (_, u) => <span className={cn('rounded-full px-2 py-1 text-xs', u.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500')}>{u.status ?? 'active'}</span> },
    { id: 'department', sortable: true, header: 'Department', accessor: u => u.department || '—', width: 150 },
    { id: 'activity', header: 'Actions', accessor: () => '', width: 90, cell: (_, u) => <button aria-label="View Activity" title="View Activity" className="min-h-11 min-w-11" onClick={() => setTimelineUser(u)}><Clock size={14} /></button> },
  ];

  const tableColumns = useModuleTableColumns('users', USERS_TABLE_COLUMNS, columns);
  const createAction = canCreateUsers && <button aria-label="New user" title="New user" disabled={rolesLoading || !!rolesError} onClick={() => setIsAddOpen(true)} className="flex shrink-0 h-11 w-11 sm:h-auto sm:w-auto items-center justify-center gap-1.5 sm:px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
      <Plus size={16} /> <span className="hidden sm:inline">New User</span>
    </button>;

  return (
    <div className="min-w-0 max-w-full space-y-4">
      {renderHeader ? renderHeader(createAction) : <div className="flex justify-end">{createAction}</div>}
      {tableColumns.drawer}
      {rolesError && <div role="alert" className="text-sm text-red-500">{rolesError} <button onClick={() => void refreshRoles()} className="underline">Retry roles</button></div>}
      <ModuleTableToolbar label="Users" search={search} onSearch={setSearch} placeholder="Search users..."
        filter={<FilterButton title="users" open={showFilters} active={!!(roleFilter.length || statusFilter.length || departmentFilter.length)} onClick={() => setShowFilters(value => !value)} />}
        refreshing={loading} onRefresh={() => setReload(value => value + 1)} onManageColumns={tableColumns.openColumns} />

      <div className="flex min-w-0 gap-3 items-stretch">
        {showFilters && <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" aria-hidden="true" onClick={() => setShowFilters(false)} />}
        {showFilters && <motion.aside initial={{ x: -260, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          id="user-filters" aria-label="User filters" onKeyDown={event => { if (event.key === 'Escape') setShowFilters(false); }}
          className="fixed inset-y-0 left-0 z-40 w-[260px] max-w-full flex flex-col shadow-2xl sm:static sm:z-auto sm:shadow-none sm:max-h-[calc(100dvh-12rem)] shrink-0 sm:self-start sm:rounded-xl border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#E4E9F0] dark:border-slate-700">
            <span className="text-[13px] font-semibold text-slate-900 dark:text-white">Filter by</span>
            <button aria-label="Close filters" onClick={() => setShowFilters(false)} className="p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-slate-500"><X size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 custom-scrollbar">
            <FilterGroupSection group={{ id: 'status', label: 'Status', items: ['active', 'inactive'].map(id => ({ id, label: id === 'active' ? 'Active' : 'Inactive', isChecked: statusFilter.includes(id) })) }} onToggle={(_, id) => setStatusFilter(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} />
            <FilterGroupSection group={{ id: 'department', label: 'Department', items: departments.map(id => ({ id, label: id, isChecked: departmentFilter.includes(id) })) }} onToggle={(_, id) => setDepartmentFilter(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} />
            <FilterGroupSection group={{ id: 'role', label: 'Role', items: roleNames.map(id => ({ id, label: id, isChecked: roleFilter.includes(id) })) }} onToggle={(_, id) => setRoleFilter(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} />
          </div>
          <div className="shrink-0 border-t border-[#E4E9F0] dark:border-slate-700 px-4 py-2.5 text-xs text-slate-500">{filtered.length} users in this module</div>
        </motion.aside>}
        <div className="min-w-0 flex-1 space-y-4">
      {loading ? <TableLoadingState label="Loading users..." /> : loadError ? <DataErrorState message={loadError} onRetry={() => setReload(value => value + 1)} /> :
        <DataGrid<User> sort={sort} sortingMode="external" onSortChange={next => setSort(next ?? { field: 'createdAt', direction: 'desc' })} columns={tableColumns.columns} data={paginated} getRowId={row => row.id} height="auto" selectable={canArchiveUsers} selectedIds={selected} onSelectionChange={setSelected} enableColumnMenu={false} ariaLabel="Team Management table" emptyMessage="No users found"
          onRowClick={u => openUser(u)} rowActions={u => [
            { id: 'view', label: 'View', onClick: () => openUser(u) },
            ...((canManageUsers || canAssignRoles || canActivateUsers || canArchiveUsers) ? [
              { id: 'edit', label: canManageUsers ? 'Edit' : 'Change access', disabled: !canManageUsers && !canAssignRoles && !canActivateUsers, onClick: () => openUser(u, true) },
              { id: 'status', label: u.status === 'active' ? 'Mark as Inactive' : 'Mark as Active', onClick: async () => { try { const result = await usersService.update(u.id, { status: u.status === 'active' ? 'inactive' : 'active' }); if (result.data) handleSavedUser(result.data); toast.success('User status updated.'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to update user status.'); } } },
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
        {confirmArchive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmArchive(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Archive User</h3>
                <button onClick={() => setConfirmArchive(null)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
              </div>
              <div className="px-6 py-5">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Archive <span className="font-semibold text-slate-900 dark:text-white">{confirmArchive.firstName} {confirmArchive.lastName}</span>? They will lose access until restored.
                </p>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
                <button onClick={() => setConfirmArchive(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">Cancel</button>
                <button disabled={archiving} onClick={handleArchive} className="px-5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg cursor-pointer">Archive</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {timelineUser && (
          <TimelineDrawer
            selectedUser={timelineUser}
            onClose={() => setTimelineUser(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
