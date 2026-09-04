'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Plus, X, Edit2, Trash2, Mail, Phone,
  Building2, Calendar, ShieldAlert, CheckCircle2,
  RefreshCcw, UserCheck, UserMinus, Download,
  Shield, Clock, Users, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';
import { invitationsApi } from '@/shared/services/invitations.api';
import { TrelloFilter } from '@/shared/components/trello-filter';
import { cn } from '@/lib/utils';
import { USE_MOCK_DATA } from '@/lib/config';
import type { User } from '@/store/types';
import type { PendingInvitation } from '@/store/types/invitation.types';

// ── Avatar ─────────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 8 }: { user: User; size?: number }): React.ReactElement {
  const initials = `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase();
  const px = size * 4;
  return (
    <div style={{ width: px, height: px, minWidth: px }}
      className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 text-[10px]">
      {initials || '?'}
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
  auditLogs: Array<{ id: string; userId?: string; userEmail?: string; action: string; details: string; timestamp: string; ipAddress?: string }>;
  onClose: () => void;
}

function TimelineDrawer({ selectedUser, auditLogs, onClose }: TimelineDrawerProps): React.ReactElement {
  const [filter, setFilter] = useState<'all' | 'auth' | 'edits' | 'permissions'>('all');
  const [search, setSearch] = useState('');

  const enriched = useMemo(() => {
    const uEmail = selectedUser.email?.toLowerCase() ?? '';
    const uName = `${selectedUser.firstName ?? ''} ${selectedUser.lastName ?? ''}`.toLowerCase();
    const logs = auditLogs.filter((log) => {
      const logEmail = log.userEmail?.toLowerCase() ?? '';
      const detailsLower = log.details?.toLowerCase() ?? '';
      const isPerformer = log.userId === selectedUser.id || (logEmail && logEmail === uEmail);
      const isTarget = (uName && detailsLower.includes(uName.trim())) || (uEmail && detailsLower.includes(uEmail));
      return isPerformer || isTarget;
    });
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [auditLogs, selectedUser]);

  const filtered = useMemo(() => {
    let result = enriched;
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
  }, [enriched, search, filter]);

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
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Clock size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-xs text-slate-400">No activity found</p>
          </div>
        ) : filtered.map((log) => (
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

// ── Add / Edit user modal ────────────────────────────────────────────────────

interface UserFormModalProps {
  mode: 'add' | 'edit';
  user?: User | null;
  roleNames: string[];
  onSave: (data: Partial<User>) => void;
  onClose: () => void;
}

function UserFormModal({ mode, user, roleNames, onSave, onClose }: UserFormModalProps): React.ReactElement {
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState(user?.role ?? (roleNames[0] ?? 'Sales Rep'));
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [status, setStatus] = useState(user?.status ?? 'active');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error('Email is required'); return; }
    onSave({ firstName, lastName, email, phone, role, jobTitle, department, status });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{mode === 'add' ? 'New User' : `Edit ${user?.firstName} ${user?.lastName}`}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Last Name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Email <span className="text-rose-500">*</span></label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={mode === 'edit'}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500">
                {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Job Title</label>
              <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Department</label>
              <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500" />
            </div>
            {mode === 'edit' && (
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'pending')}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">Cancel</button>
            <button type="submit" className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-md shadow-blue-500/20 cursor-pointer">
              {mode === 'add' ? 'Create User' : 'Save Changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Invite modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  roles: Array<{ id: string; name: string }>;
  onClose: () => void;
  onInvited: () => void;
}

function InviteModal({ roles, onClose, onInvited }: InviteModalProps): React.ReactElement {
  const [emails, setEmails] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    const emailList = emails.split(',').map((e) => e.trim()).filter(Boolean);
    if (emailList.length === 0) { toast.error('Enter at least one email address'); return; }
    if (!roleId) { toast.error('Select a role'); return; }
    setIsLoading(true);
    try {
      const res = await invitationsApi.create(emailList, roleId);
      const { sent, skipped } = res.data;
      if (sent.length > 0) toast.success(`Invitation sent to ${sent.join(', ')}`);
      if (skipped.length > 0) toast.info(`Skipped: ${skipped.map((s: { email: string; reason: string }) => `${s.email} (${s.reason})`).join(', ')}`);
      onInvited();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Invite Team Members</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Email addresses <span className="text-slate-400 font-normal">(comma-separated)</span></label>
            <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="alice@company.com, bob@company.com"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Role</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500">
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">Cancel</button>
          <button onClick={handleSend} disabled={isLoading} className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg shadow-md shadow-blue-500/20 cursor-pointer">
            {isLoading ? 'Sending...' : 'Send Invites'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main UsersSubTab ──────────────────────────────────────────────────────────

export function UsersSubTab(): React.ReactElement {
  const { user: currentUser, userCan } = useAuth();
  const { users: allUsers, roles, addUser, updateUser, deleteUser, auditLogs } = useData();
  const tenantId = currentUser?.tenantId ?? '';

  const tenantUsers = useMemo(
    () => allUsers.filter((u) => u.tenantId === tenantId),
    [allUsers, tenantId],
  );
  const roleNames = useMemo(() => roles.filter((r) => !r.isArchived).map((r) => r.name), [roles]);
  const roleObjs = useMemo(() => roles.filter((r) => !r.isArchived).map((r) => ({ id: r.id, name: r.name })), [roles]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [timelineUser, setTimelineUser] = useState<User | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<User | null>(null);

  // Pending invitations (real API mode only)
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [isInvitationsLoading, setIsInvitationsLoading] = useState(false);

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    loadInvitations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInvitations = async (): Promise<void> => {
    setIsInvitationsLoading(true);
    try {
      const res = await invitationsApi.list();
      setPendingInvitations(res?.data ?? []);
    } catch {
      // non-critical
    } finally {
      setIsInvitationsLoading(false);
    }
  };

  const handleRevokeInvitation = async (id: string, email: string): Promise<void> => {
    try {
      await invitationsApi.revoke(id);
      toast.success(`Invitation revoked for ${email}`);
      setPendingInvitations((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invitation');
    }
  };

  const filtered = useMemo(() => {
    return tenantUsers.filter((u) => {
      if (!showArchived && u.isArchived) return false;
      const matchSearch = !search || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter.length === 0 || roleFilter.includes(u.role);
      const matchStatus = statusFilter.length === 0 || statusFilter.some((s) => s.toLowerCase() === (u.status ?? '').toLowerCase());
      return matchSearch && matchRole && matchStatus;
    });
  }, [tenantUsers, search, roleFilter, statusFilter, showArchived]);

  const { currentPage, totalPages, pageSize, totalItems, paginateItems, goToPage, setPageSize } = usePagination({
    totalItems: filtered.length,
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50],
    resetDeps: [search, roleFilter, statusFilter, showArchived],
  });
  const paginated = paginateItems(filtered);

  const handleAddUser = (data: Partial<User>) => {
    addUser(data);
    toast.success(`User ${data.firstName ?? ''} ${data.lastName ?? ''} created`);
    setIsAddOpen(false);
  };

  const handleEditUser = (data: Partial<User>) => {
    if (!editingUser) return;
    updateUser(editingUser.id, data);
    toast.success('User updated');
    setEditingUser(null);
  };

  const handleArchive = () => {
    if (!confirmArchive) return;
    deleteUser(confirmArchive.id);
    toast.success(`${confirmArchive.firstName} ${confirmArchive.lastName} archived`);
    setConfirmArchive(null);
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) { toast.error('No users to export'); return; }
    const headers = ['Name', 'Email', 'Role', 'Status', 'Phone', 'Department'];
    const rows = filtered.map((u) => [
      `"${u.firstName} ${u.lastName}"`, u.email, u.role, u.status ?? '',
      u.phone ?? '', u.department ?? '',
    ]);
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `team_members_${Date.now()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    toast.success('Users exported');
  };

  const canManageUsers = userCan('users', 'canEdit');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/[0.08] text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors placeholder-slate-400" />
        </div>
        <TrelloFilter
          searchTerm=""
          setSearchTerm={() => {}}
          statuses={roleNames.map((r) => ({ id: r, label: r }))}
          selectedStatuses={roleFilter}
          setSelectedStatuses={setRoleFilter}
          labelsTitle="Role"
        />
        <TrelloFilter
          searchTerm=""
          setSearchTerm={() => {}}
          statuses={[
            { id: 'active', label: 'Active' },
            { id: 'inactive', label: 'Inactive' },
            { id: 'pending', label: 'Pending' },
          ]}
          selectedStatuses={statusFilter}
          setSelectedStatuses={setStatusFilter}
          labelsTitle="Status"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-blue-500" />
          Show archived
        </label>
        <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold cursor-pointer transition-colors">
          <Download size={13} /> Export
        </button>
        {canManageUsers && (
          <>
            <button onClick={() => setIsInviteOpen(true)} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold cursor-pointer transition-colors">
              <Mail size={13} /> Invite
            </button>
            <button onClick={() => setIsAddOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-sm">
              <Plus size={13} /> New User
            </button>
          </>
        )}
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-white/[0.07] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(160px,2fr)_minmax(120px,1.5fr)_minmax(180px,2fr)_80px_120px_40px] gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.05] min-w-[680px]">
            {['User', 'Role', 'Contact', 'Status', 'Department', ''].map((h, i) => (
              <div key={i} className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {paginated.length === 0 ? (
            <div className="py-16 text-center min-w-[680px]">
              <Users size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-xs text-slate-400">No users found</p>
            </div>
          ) : paginated.map((u) => (
            <div key={u.id}
              className={cn('grid grid-cols-[minmax(160px,2fr)_minmax(120px,1.5fr)_minmax(180px,2fr)_80px_120px_40px] gap-3 px-4 py-3 items-center border-b border-gray-100 dark:border-white/[0.04] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors group min-w-[680px]',
                u.isArchived && 'opacity-50')}>
              {/* User */}
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar user={u} size={8} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{u.firstName} {u.lastName}</p>
                  {u.isArchived && <span className="text-[9px] text-rose-500 font-bold">Archived</span>}
                </div>
              </div>
              {/* Role */}
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit', roleColor(u.role))}>{u.role}</span>
              {/* Contact */}
              <div className="min-w-0">
                <p className="text-xs text-blue-500 truncate">{u.email}</p>
                {u.phone && <p className="text-[10px] text-slate-400">{u.phone}</p>}
              </div>
              {/* Status */}
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit',
                u.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
                u.status === 'pending' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                'bg-slate-500/10 text-slate-500 border-slate-500/20')}>
                {u.status ?? 'active'}
              </span>
              {/* Department */}
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.department || '—'}</span>
              {/* Actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setTimelineUser(u)} title="View Activity" className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded cursor-pointer transition-colors"><Clock size={12} /></button>
                {canManageUsers && (
                  <>
                    <button onClick={() => setEditingUser(u)} title="Edit" className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded cursor-pointer transition-colors"><Edit2 size={12} /></button>
                    {!u.isArchived && (
                      <button onClick={() => setConfirmArchive(u)} title="Archive" className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded cursor-pointer transition-colors"><Trash2 size={12} /></button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={goToPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[10, 25, 50]}
        />
      )}

      {/* Pending Invitations */}
      {!USE_MOCK_DATA && pendingInvitations.length > 0 && (
        <div className="bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-white/[0.07] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.05]">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Pending Invitations ({isInvitationsLoading ? '…' : pendingInvitations.length})
            </p>
          </div>
          {pendingInvitations.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/[0.04] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">{inv.email}</p>
                <p className="text-[10px] text-slate-400">Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
              </div>
              {canManageUsers && (
                <button onClick={() => handleRevokeInvitation(inv.id, inv.email)}
                  className="px-3 py-1.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg cursor-pointer transition-colors">
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {isAddOpen && (
          <UserFormModal mode="add" roleNames={roleNames} onSave={handleAddUser} onClose={() => setIsAddOpen(false)} />
        )}
        {editingUser && (
          <UserFormModal mode="edit" user={editingUser} roleNames={roleNames} onSave={handleEditUser} onClose={() => setEditingUser(null)} />
        )}
        {isInviteOpen && (
          <InviteModal roles={roleObjs} onClose={() => setIsInviteOpen(false)} onInvited={loadInvitations} />
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
                <button onClick={handleArchive} className="px-5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg cursor-pointer">Archive</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {timelineUser && (
          <TimelineDrawer
            selectedUser={timelineUser}
            auditLogs={auditLogs as Parameters<typeof TimelineDrawer>[0]['auditLogs']}
            onClose={() => setTimelineUser(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
