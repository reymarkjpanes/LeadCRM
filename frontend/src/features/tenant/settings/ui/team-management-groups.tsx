'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, X, Edit2, Trash2, MoreHorizontal, Users, ArrowLeft, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { groupsApi, TenantGroup } from '@/shared/services/groups.api';
import { cn } from '@/lib/utils';
import type { User } from '@/store/types';
import { USE_MOCK_DATA } from '@/lib/config';

// ── Avatar ─────────────────────────────────────────────────────────────────

function UserAvatar({ firstName, lastName, size = 8 }: { firstName: string; lastName: string; size?: number }): React.ReactElement {
  const initials = `${firstName?.charAt(0) ?? ''}${lastName?.charAt(0) ?? ''}`.toUpperCase();
  const px = size * 4;
  return (
    <div style={{ width: px, height: px, minWidth: px }}
      className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 text-[10px]">
      {initials || '?'}
    </div>
  );
}

interface GroupsSubTabProps {
  tenantUsers: User[];
}

export function GroupsSubTab({ tenantUsers }: GroupsSubTabProps): React.ReactElement {
  const { userCan } = useAuth();
  const canManage = userCan('users', 'canEdit');

  const [groups, setGroups] = useState<TenantGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeGroup, setActiveGroup] = useState<TenantGroup | null>(null);

  // List view state
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newSelectedIds, setNewSelectedIds] = useState<string[]>([]);
  const [newMemberSearch, setNewMemberSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Detail view state
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
  const [addMemberSelected, setAddMemberSelected] = useState<string[]>([]);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    loadGroups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const res = await groupsApi.getAll();
      setGroups(res.data ?? []);
    } catch {
      // non-critical — stays empty
    } finally {
      setIsLoading(false);
    }
  };

  // Sync activeGroup from the groups list so member counts stay fresh
  useEffect(() => {
    if (activeGroup) {
      const fresh = groups.find((g) => g.id === activeGroup.id);
      if (fresh) setActiveGroup(fresh);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) { toast.error('Group name is required'); return; }
    setIsCreating(true);
    try {
      const res = await groupsApi.create(newGroupName.trim());
      const created = res.data;
      // Add selected members
      await Promise.all(newSelectedIds.map((uid) => groupsApi.addMember(created.id, uid).catch(() => null)));
      await loadGroups();
      const fresh = (await groupsApi.getAll()).data.find((g) => g.id === created.id) ?? created;
      setSuccessMsg(`The group "${fresh.name}" was successfully created.`);
      setActiveGroup(fresh);
      setIsNewGroupOpen(false); setNewGroupName(''); setNewSelectedIds([]); setNewMemberSearch('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await groupsApi.remove(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      if (activeGroup?.id === id) setActiveGroup(null);
      toast.success('Group deleted');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete group');
    }
  };

  const handleDuplicateGroup = async (group: TenantGroup) => {
    try {
      const res = await groupsApi.create(`${group.name} (Copy)`);
      const dup = res.data;
      await Promise.all(group.members.map((m) => groupsApi.addMember(dup.id, m.userId).catch(() => null)));
      await loadGroups();
      toast.success('Group duplicated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate group');
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try {
      await groupsApi.removeMember(groupId, userId);
      setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, members: g.members.filter((m) => m.userId !== userId) } : g));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleAddMembers = async () => {
    if (!activeGroup) return;
    try {
      await Promise.all(addMemberSelected.map((uid) => groupsApi.addMember(activeGroup.id, uid)));
      await loadGroups();
      setAddMemberSelected([]); setIsAddMembersOpen(false);
      toast.success('Members added');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add members');
    }
  };

  const handleSaveGroupName = async () => {
    if (!activeGroup || !editGroupName.trim()) return;
    try {
      await groupsApi.update(activeGroup.id, editGroupName.trim());
      await loadGroups();
      setIsEditNameOpen(false);
      toast.success('Group name updated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name');
    }
  };

  const availableForNew = useMemo(
    () => tenantUsers.filter((u) => !newSelectedIds.includes(u.id) && `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(newMemberSearch.toLowerCase())),
    [tenantUsers, newSelectedIds, newMemberSearch],
  );

  // ── Detail view ────────────────────────────────────────────────────────────
  if (activeGroup) {
    const groupData = groups.find((g) => g.id === activeGroup.id) ?? activeGroup;
    const memberUserIds = groupData.members.map((m) => m.userId);
    const members = tenantUsers.filter((u) => memberUserIds.includes(u.id));
    const filteredMembers = members.filter((u) => `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(groupMemberSearch.toLowerCase()));
    const available = tenantUsers.filter((u) => !memberUserIds.includes(u.id) && `${u.firstName} ${u.lastName}`.toLowerCase().includes(newMemberSearch.toLowerCase()));

    return (
      <div className="space-y-4">
        {/* Back + title */}
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => { setActiveGroup(null); setSuccessMsg(''); }} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer mb-1">
              <ArrowLeft size={13} /> Groups
            </button>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{groupData.name}</h2>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditGroupName(groupData.name); setIsEditNameOpen(true); }} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"><Edit2 size={15} /></button>
              <div className="relative">
                <button onClick={() => setIsMoreMenuOpen((v) => !v)} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"><MoreHorizontal size={15} /></button>
                <AnimatePresence>
                  {isMoreMenuOpen && (
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg z-20 py-1"
                      onMouseLeave={() => setIsMoreMenuOpen(false)}>
                      <button onClick={() => { handleDuplicateGroup(groupData); setIsMoreMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer"><Copy size={12} /> Duplicate</button>
                      <button onClick={() => { handleDeleteGroup(groupData.id); setIsMoreMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer"><Trash2 size={12} /> Delete</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Success banner */}
        <AnimatePresence>
          {successMsg && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{successMsg}</p>
              <button onClick={() => setSuccessMsg('')} className="text-amber-500 cursor-pointer"><X size={13} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter + add members */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Filter members..." value={groupMemberSearch} onChange={(e) => setGroupMemberSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors placeholder-slate-400" />
          </div>
          {canManage && (
            <div className="relative ml-auto">
              <button onClick={() => { setIsAddMembersOpen((v) => !v); setAddMemberSelected([]); setNewMemberSearch(''); }}
                className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer">
                <Plus size={13} /> Add Members
              </button>
              <AnimatePresence>
                {isAddMembersOpen && (
                  <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg z-20 overflow-hidden"
                    onClick={(e) => e.stopPropagation()}>
                    <div className="p-2 border-b border-gray-100 dark:border-white/[0.05] max-h-52 overflow-y-auto custom-scrollbar">
                      <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] rounded">
                        <input type="checkbox" checked={addMemberSelected.length === available.length && available.length > 0}
                          onChange={(e) => setAddMemberSelected(e.target.checked ? available.map((u) => u.id) : [])}
                          className="w-3.5 h-3.5 accent-blue-500" />
                        Select all
                      </label>
                      {available.map((u) => (
                        <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.04] rounded">
                          <input type="checkbox" checked={addMemberSelected.includes(u.id)}
                            onChange={() => setAddMemberSelected((prev) => prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                            className="w-3.5 h-3.5 accent-blue-500" />
                          <UserAvatar firstName={u.firstName ?? ''} lastName={u.lastName ?? ''} size={6} />
                          <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{u.firstName} {u.lastName}</span>
                        </label>
                      ))}
                      {available.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">No users to add</p>}
                    </div>
                    <div className="flex gap-2 justify-end p-2">
                      <button onClick={() => setIsAddMembersOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">Cancel</button>
                      <button onClick={handleAddMembers} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer">Add</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Members table */}
        <div className="bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-white/[0.07] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[minmax(140px,2fr)_minmax(80px,1fr)_minmax(160px,2fr)_36px] gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.05] min-w-[440px]">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{members.length} Member{members.length !== 1 ? 's' : ''}</span>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role</span>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Email</span>
              <span />
            </div>
            {filteredMembers.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 min-w-[440px]">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><Users size={24} className="text-slate-400" /></div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">No members yet</p>
                <p className="text-xs text-slate-400">Use &quot;Add Members&quot; to add users to this group.</p>
              </div>
            ) : filteredMembers.map((u) => (
              <div key={u.id} className="grid grid-cols-[minmax(140px,2fr)_minmax(80px,1fr)_minmax(160px,2fr)_36px] gap-3 px-4 py-3 items-center border-b border-gray-100 dark:border-white/[0.04] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors min-w-[440px]">
                <div className="flex items-center gap-2.5">
                  <UserAvatar firstName={u.firstName ?? ''} lastName={u.lastName ?? ''} size={8} />
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">{u.firstName} {u.lastName}</span>
                </div>
                <span className="text-xs text-slate-600 dark:text-slate-300">{u.role}</span>
                <span className="text-xs text-blue-500 truncate">{u.email}</span>
                {canManage && (
                  <button onClick={() => handleRemoveMember(groupData.id, u.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded cursor-pointer transition-colors"><X size={12} /></button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Edit name modal */}
        <AnimatePresence>
          {isEditNameOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setIsEditNameOpen(false)}>
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Rename Group</h3>
                  <button onClick={() => setIsEditNameOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
                </div>
                <div className="px-6 py-5">
                  <input type="text" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveGroupName()}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
                  <button onClick={() => setIsEditNameOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">Cancel</button>
                  <button onClick={handleSaveGroupName} className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer">Save</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Groups list view ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <button onClick={() => { setIsNewGroupOpen(true); setNewGroupName(''); setNewSelectedIds([]); setNewMemberSearch(''); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer">
            <Plus size={13} /> New Group
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="py-20 text-center text-xs text-slate-400">Loading groups…</div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
          <Users size={36} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">No groups yet</p>
          <p className="text-xs text-slate-400 mb-4">Create groups to organise your team members.</p>
          {canManage && (
            <button onClick={() => setIsNewGroupOpen(true)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg cursor-pointer mx-auto">
              <Plus size={13} /> Create Group
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-white/[0.07] rounded-xl overflow-hidden">
          {groups.map((g, idx) => (
            <div key={g.id} className={cn('flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer group', idx !== 0 && 'border-t border-gray-100 dark:border-white/[0.04]')}
              onClick={() => { setActiveGroup(g); setGroupMemberSearch(''); }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center"><Users size={14} className="text-blue-500" /></div>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">{g.name}</p>
                  <p className="text-[10px] text-slate-400">{g.members.length} member{g.members.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {canManage && (
                <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New group modal */}
      <AnimatePresence>
        {isNewGroupOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setIsNewGroupOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">New Group</h3>
                <button onClick={() => setIsNewGroupOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
              </div>
              <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Name</label>
                  <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} autoFocus
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Add Members <span className="font-normal text-slate-400">(optional)</span></label>
                  {newSelectedIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {newSelectedIds.map((id) => {
                        const u = tenantUsers.find((x) => x.id === id);
                        if (!u) return null;
                        return (
                          <span key={id} className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium">
                            {u.firstName} {u.lastName}
                            <button onClick={() => setNewSelectedIds((p) => p.filter((x) => x !== id))} className="cursor-pointer hover:text-rose-500"><X size={10} /></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input type="text" placeholder="Search users…" value={newMemberSearch} onChange={(e) => setNewMemberSearch(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 mb-2" />
                  <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                    {availableForNew.length === 0 ? (
                      <p className="text-xs text-slate-400 py-2 text-center">No users available</p>
                    ) : availableForNew.map((u) => (
                      <button key={u.id} onClick={() => setNewSelectedIds((p) => p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id])}
                        className="w-full flex items-center gap-3 px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors text-left">
                        <UserAvatar firstName={u.firstName ?? ''} lastName={u.lastName ?? ''} size={8} />
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">{u.firstName} {u.lastName}</p>
                          <p className="text-[10px] text-slate-400">{u.email}</p>
                        </div>
                        {newSelectedIds.includes(u.id) && <div className="ml-auto w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center"><div className="w-2 h-2 bg-white rounded-full" /></div>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
                <button onClick={() => setIsNewGroupOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">Cancel</button>
                <button onClick={handleCreateGroup} disabled={isCreating}
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg shadow-md shadow-blue-500/20 cursor-pointer">
                  {isCreating ? 'Creating…' : 'Create Group'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
