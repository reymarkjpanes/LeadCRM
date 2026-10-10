'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Edit2, MoreHorizontal, Plus, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { GroupNameSchema, type TenantGroupMember } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import type { User } from '@/store/types';
import { groupsApi, type TenantGroup } from '@/shared/services/groups.api';
import { USE_MOCK_DATA } from '@/lib/config';
import { Button, CreateButton } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/shared/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { ModuleSearchInput } from '@/shared/components/crm/module-search-input';
import { RecordBackButton } from '@/shared/components/crm/record-back-button';
import { AvatarCell } from '@/shared/components/crm/avatar-cell';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { useConfirmDialog } from '@/shared/hooks/use-confirm-dialog';
import { DataGrid, type DataGridColumnDef } from '@/shared/components/data-grid';

interface GroupsSubTabProps {
  tenantUsers: User[];
  renderHeader?: (action: React.ReactNode) => React.ReactNode;
}
const memberName = (user: TenantGroupMember['user']) => `${user.firstName} ${user.lastName}`.trim();
const initials = (user: TenantGroupMember['user']) => `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unable to update group. Please try again.';

export function GroupsSubTab({ tenantUsers, renderHeader }: GroupsSubTabProps): React.ReactElement {
  const { user, userCan } = useAuth();
  const canManage = userCan('groups', 'canEdit'), canCreate = userCan('groups', 'canCreate'), canDelete = userCan('groups', 'canDelete');
  const canManageMembers = user?.role?.trim().toLowerCase() === 'client admin';
  const [groups, setGroups] = useState<TenantGroup[]>([]);
  const [search, setSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(!USE_MOCK_DATA);
  const [loaded, setLoaded] = useState(USE_MOCK_DATA);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);
  const reloadPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<'create' | 'rename' | 'members' | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const { confirm, close, dialogProps } = useConfirmDialog();
  const active = groups.find(group => group.id === activeId);
  const loadGroups = useCallback(async () => {
    if (loadingRef.current) { reloadPending.current = true; return; }
    loadingRef.current = true; setLoading(true); setLoadError('');
    try {
      do {
        reloadPending.current = false;
        const result = await groupsApi.getAll();
        if (!mounted.current) return;
        setGroups(result.data); setLoaded(true);
      } while (reloadPending.current && mounted.current);
    }
    catch (error) { if (mounted.current) { setLoadError(errorMessage(error)); if ([401, 403].includes((error as { status?: number }).status ?? 0)) { setGroups([]); setLoaded(false); } } }
    finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { if (!USE_MOCK_DATA) void loadGroups(); }, [loadGroups]);
  useEffect(() => { const changed = () => { if (!USE_MOCK_DATA) void loadGroups(); }; window.addEventListener('leadcrm:groups-changed', changed); return () => window.removeEventListener('leadcrm:groups-changed', changed); }, [loadGroups]);

  const mutate = async (action: () => Promise<void>, propagateError = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setSaveError('');
    try { await action(); }
    catch (error) { const message = errorMessage(error); setSaveError(message); if (propagateError) throw new Error(message); toast.error(message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openModal = (value: typeof modal) => {
    setModal(value); setName(value === 'rename' ? active?.name ?? '' : '');
    setNameError(''); setSaveError(''); setSelectedIds([]); setUserSearch('');
  };
  const addMembers = async (groupId: string, ids: string[]) => {
    const results = await Promise.allSettled([...new Set(ids)].map(id => groupsApi.addMember(groupId, id)));
    const added = ids.filter((_, index) => results[index]?.status === 'fulfilled');
    if (added.length) toast.success('Member added successfully.');
    await loadGroups();
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      setSelectedIds(ids.filter(id => !added.includes(id)));
      throw new Error(errorMessage(failed.reason));
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = GroupNameSchema.safeParse(name);
    if (modal !== 'members' && !parsed.success) { setNameError(parsed.error.issues[0].message); return; }
    await mutate(async () => {
      if (modal === 'create' && canCreate && parsed.success) {
        const created = (await groupsApi.create(parsed.data)).data;
        setGroups(previous => [...previous, created]); setLoaded(true); setActiveId(created.id); setMemberSearch('');
        toast.success('Group created successfully.');
        // Creation is committed even if an optional member operation fails.
        setModal('members');
        if (canManageMembers && selectedIds.length) await addMembers(created.id, selectedIds);
      } else if (modal === 'rename' && active && canManage && parsed.success) {
        const updated = (await groupsApi.update(active.id, parsed.data)).data;
        setGroups(previous => previous.map(group => group.id === active.id ? updated : group));
        toast.success('Group name updated');
      } else if (modal === 'members' && active && canManageMembers) {
        await addMembers(active.id, selectedIds.filter(id => !active.members.some(member => member.userId === id)));
      }
      setModal(null);
    });
  };
  const requestDelete = (group: TenantGroup) => {
    if (!canDelete) return;
    if (group.members.length) { toast.error('Remove all members from this group before deleting it.'); return; }
    confirm({ title: 'Delete group?', description: 'Are you sure you want to delete this group? This action cannot be undone.',
      confirmLabel: 'Delete Group', variant: 'destructive', onConfirm: () => mutate(async () => {
        await groupsApi.remove(group.id);
        setGroups(previous => previous.filter(row => row.id !== group.id));
        if (activeId === group.id) setActiveId(null);
        close(); toast.success('Group deleted successfully.');
      }, true) });
  };
  const requestRemove = (member: TenantGroupMember) => {
    if (!active || !canManageMembers) return;
    const groupId = active.id;
    confirm({ title: 'Remove member?', description: `Are you sure you want to remove ${memberName(member.user)} from this group?`,
      confirmLabel: 'Remove Member', variant: 'destructive', onConfirm: () => mutate(async () => {
        await groupsApi.removeMember(groupId, member.userId);
        setGroups(previous => previous.map(group => group.id === groupId ? { ...group, members: group.members.filter(row => row.userId !== member.userId) } : group));
        close(); toast.success('Member removed successfully.');
      }, true) });
  };
  const duplicate = (group: TenantGroup) => mutate(async () => {
    const created = (await groupsApi.create(`${group.name.slice(0, 93)} (Copy)`)).data;
    setGroups(previous => [...previous, created]);
    if (canManageMembers && group.members.length) await addMembers(created.id, group.members.map(member => member.userId));
    toast.success('Group duplicated');
  });
  const visibleGroups = groups.filter(group => group.name.toLowerCase().includes(search.trim().toLowerCase()));
  const members = active?.members ?? [];
  const visibleMembers = members.filter(member => `${memberName(member.user)} ${member.user.email} ${member.user.role}`.toLowerCase().includes(memberSearch.trim().toLowerCase()));
  const availableUsers = tenantUsers.filter(user => (modal === 'create' || !members.some(member => member.userId === user.id)) &&
    `${user.firstName} ${user.lastName} ${user.email} ${user.role}`.toLowerCase().includes(userSearch.trim().toLowerCase()));
  const columns: DataGridColumnDef<TenantGroupMember>[] = [
    { id: 'name', header: `${members.length} Member${members.length === 1 ? '' : 's'}`, accessor: member => memberName(member.user), width: 250,
      cell: (_, member) => <AvatarCell name={memberName(member.user)} initials={initials(member.user)} /> },
    { id: 'role', header: 'Role', accessor: member => member.user.role, width: 180 },
    { id: 'email', header: 'Email', accessor: member => member.user.email, width: 260 },
    ...(canManageMembers ? [{ id: 'actions', header: 'Actions', accessor: () => '', width: 80,
      cell: (_: unknown, member: TenantGroupMember) => <Button variant="ghost" size="icon" disabled={busy} aria-label={`Remove ${memberName(member.user)}`} title="Remove member" onClick={() => requestRemove(member)}><X size={14} /></Button> }] : []),
  ];
  const createAction = canCreate && <CreateButton label="New Group" onClick={() => openModal('create')} />;
  const header = renderHeader ? renderHeader(createAction) : <div className="flex justify-end">{createAction}</div>;

  return <div className="w-full min-w-0 space-y-4">
    {header}
    {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 p-3 text-sm text-rose-600"><p className="min-w-0 flex-1">{loadError}</p><Button variant="outline" onClick={loadGroups} disabled={loading}>Retry</Button></div>}
    {active ? <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0"><RecordBackButton label="Groups" onClick={() => setActiveId(null)} /><h2 className="break-words text-xl font-bold text-slate-900 dark:text-white">{active.name}</h2></div>
        <div className="flex shrink-0 gap-1">
          {canManage && <Button variant="ghost" size="icon" title="Edit group" aria-label="Edit group" onClick={() => openModal('rename')}><Edit2 size={16} /></Button>}
          {(canCreate || canDelete) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Group actions" title="Group actions"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent>
            {canCreate && <DropdownMenuItem disabled={busy || (!canManageMembers && !!active.members.length)} onSelect={() => void duplicate(active)}><Copy size={14} />Duplicate</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem destructive onSelect={() => requestDelete(active)}><Trash2 size={14} />Delete Group</DropdownMenuItem>}
          </DropdownMenuContent></DropdownMenu>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ModuleSearchInput value={memberSearch} onChange={setMemberSearch} placeholder="Search members..." />
        {canManageMembers && <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={() => openModal('members')}><Plus size={14} />Add Members</Button>}
      </div>
      <DataGrid ariaLabel="Group members" columns={columns} data={visibleMembers} getRowId={member => member.id} height="auto" emptyMessage={members.length ? 'No members match your search.' : canManageMembers ? 'No members yet. Use Add Members to add users to this group.' : 'No members yet.'} />
    </> : <>
      <ModuleTableToolbar label="Groups" search={search} onSearch={setSearch} placeholder="Search groups..." refreshing={loading} onRefresh={loadGroups} />
      {loading && !loaded ? <Card role="status" aria-label="Loading groups" className="rounded-xl shadow-none overflow-hidden"><div aria-hidden="true"><DataLoadingSkeleton rowCount={4} columnCount={2} rowHeight={64} /></div></Card> : loaded && <Card className="rounded-xl shadow-none overflow-hidden" aria-busy={loading}>
        {visibleGroups.map(group => <div key={group.id} className="flex min-w-0 items-center gap-2 border-b border-slate-100 dark:border-slate-800 last:border-0 px-3 py-2">
          <button aria-label={`Open ${group.name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setActiveId(group.id); setMemberSearch(''); }}>
            <span className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2 text-blue-500"><Users size={16} /></span>
            <span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-900 dark:text-white">{group.name}</span><span className="text-xs text-slate-500">{group.members.length} member{group.members.length === 1 ? '' : 's'}</span></span>
          </button>
          {canDelete && <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Delete ${group.name}`} title={group.members.length ? 'Remove all members from this group before deleting it.' : 'Delete group'} disabled={busy} onClick={() => requestDelete(group)}><Trash2 size={14} /></Button>}
        </div>)}
        {!visibleGroups.length && <div className="p-8 text-center text-sm text-slate-500"><Users size={28} className="mx-auto mb-3" /><p>{groups.length ? 'No groups match your search.' : 'No groups yet.'}</p>{!groups.length && canCreate && <Button size="sm" className="mt-3" onClick={() => openModal('create')}><Plus size={14} />Create Group</Button>}</div>}
      </Card>}
    </>}
    <Dialog open={!!modal} onOpenChange={open => { if (!open && !busy) setModal(null); }}>
      <DialogContent trapFocus className="max-h-[90dvh] overflow-y-auto p-4 sm:p-6" aria-labelledby="group-modal-title" showClose={!busy}>
        <DialogHeader><DialogTitle id="group-modal-title">{modal === 'create' ? 'New Group' : modal === 'rename' ? 'Rename Group' : 'Add Members'}</DialogTitle></DialogHeader>
        <form onSubmit={save} noValidate className="mt-5 space-y-4">
          {modal !== 'members' && <div><label htmlFor="group-name" className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">Name <span className="text-red-500" aria-hidden="true">*</span></label>
            <input id="group-name" required autoFocus maxLength={100} disabled={busy} value={name} onChange={event => { setName(event.target.value); setNameError(''); }} aria-invalid={!!nameError} aria-describedby={nameError ? 'group-name-error' : undefined}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            {nameError && <p id="group-name-error" role="alert" className="mt-1 text-xs text-red-500">{nameError}</p>}
          </div>}
          {modal !== 'rename' && canManageMembers && <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Add Members {modal === 'create' && <span className="font-normal text-slate-400">(optional)</span>}</p>
            <ModuleSearchInput value={userSearch} onChange={setUserSearch} placeholder="Search users..." disabled={busy} />
            <div className="max-h-52 overflow-y-auto space-y-1">
              {availableUsers.map(user => <label key={user.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <input type="checkbox" disabled={busy} checked={selectedIds.includes(user.id)} onChange={() => setSelectedIds(previous => previous.includes(user.id) ? previous.filter(id => id !== user.id) : [...previous, user.id])} aria-label={`Select ${user.firstName} ${user.lastName}`} className="shrink-0 accent-primary" />
                <AvatarCell name={`${user.firstName} ${user.lastName}`} subtitle={user.email} initials={`${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`} />
              </label>)}
              {!availableUsers.length && <p className="py-3 text-xs text-slate-500">No users available.</p>}
            </div>
          </div>}
          {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
          <DialogFooter className="flex-wrap gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={busy || (modal === 'members' && !selectedIds.length)}>{busy ? 'Saving…' : modal === 'create' ? 'Create Group' : modal === 'rename' ? 'Save' : 'Add Members'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmActionDialog {...dialogProps} />
  </div>;
}
