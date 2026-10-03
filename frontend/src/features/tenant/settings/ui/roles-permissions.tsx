'use client';

import React, { useState, useId, useMemo, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Copy, Trash2, Users, Shield, Info, X, MoreHorizontal, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { toast } from 'sonner';
import type { RoleDefinition, Permission } from '@/store/types';
import { PERMISSION_GROUPS, togglePermissionSelection } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/shared/components/ui/dropdown-menu';

// ── Permission group definitions ─────────────────────────────────────────────

interface PermGroup {
  id: string;
  label: string;
  description: string;
  modules: string[];
}

const PERM_GROUPS: PermGroup[] = PERMISSION_GROUPS;

// ── Toggle component ──────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label: string;
  partial?: boolean;
}

function Toggle({ checked, onChange, disabled = false, size = 'sm', label, partial = false }: ToggleProps): React.ReactElement {
  const partialId = useId();
  const w = size === 'md' ? 44 : 36;
  const h = size === 'md' ? 24 : 20;
  const thumb = size === 'md' ? 18 : 14;
  const travel = w - h; // px travel for thumb

  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-describedby={partial ? partialId : undefined}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{ width: w, height: h, padding: '2px' }}
      className={cn(
        'rounded-full flex items-center transition-colors duration-200 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2',
        partial ? 'bg-amber-500' : checked ? 'bg-[var(--primary)]' : 'bg-slate-300 dark:bg-slate-600',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      {partial && <span id={partialId} className="sr-only">Partially enabled</span>}
      <div
        style={{ width: thumb, height: thumb, transform: partial ? `translateX(${travel / 2}px)` : checked ? `translateX(${travel}px)` : 'translateX(0)' }}
        className="bg-white rounded-full shadow-sm transition-transform duration-200"
      />
    </button>
  );
}

// ── Permission row ────────────────────────────────────────────────────────────

interface PermRowProps {
  perm: Permission;
  checked: boolean;
  onChange: (id: string, v: boolean) => void;
  disabled?: boolean;
}

function PermRow({ perm, checked, onChange, disabled }: PermRowProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 dark:border-white/[0.04] last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">{perm.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{perm.description}</p>
      </div>
      <Toggle label={perm.name} checked={checked} onChange={(v) => onChange(perm.id, v)} disabled={disabled} />
    </div>
  );
}

// ── Permission section card ────────────────────────────────────────────────────

interface PermSectionProps {
  group: PermGroup;
  allPerms: Permission[];
  activePermIds: string[];
  onToggle: (id: string, v: boolean) => void;
  onGroupToggle: (ids: string[], v: boolean) => void;
  disabled?: boolean;
}

function PermSection({ group, allPerms, activePermIds, onToggle, onGroupToggle, disabled }: PermSectionProps): React.ReactElement {
  const groupPerms = useMemo(
    () => allPerms.filter((p) => group.modules.includes(p.category)),
    [allPerms, group.modules],
  );

  const enabledCount = groupPerms.filter((p) => activePermIds.includes(p.id)).length;
  const allEnabled = groupPerms.length > 0 && enabledCount === groupPerms.length;
  const someEnabled = enabledCount > 0 && !allEnabled;

  return (
    <div className="bg-white dark:bg-[#16191E] border border-gray-200 dark:border-[#262A33] rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-5 py-4 bg-slate-50/50 dark:bg-white/[0.02] border-b border-gray-100 dark:border-white/[0.05]">
        <div className="flex items-center gap-3 min-w-0">
          <Toggle
            label={group.label}
            partial={someEnabled}
            checked={allEnabled || someEnabled}
            onChange={(v) => onGroupToggle(groupPerms.map(permission => permission.id), v)}
            disabled={disabled || groupPerms.length === 0}
            size="md"
          />
          <div className="min-w-0 break-words">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{group.label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{group.description}</p>
          </div>
        </div>
        <span className={cn(
          'shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full',
          allEnabled ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' : someEnabled ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
        )}>
          {enabledCount}/{groupPerms.length}
        </span>
      </div>
      {/* Permission rows */}
      <div className="px-5">
        {groupPerms.map((perm) => (
          <PermRow key={perm.id} perm={perm} checked={activePermIds.includes(perm.id)} onChange={onToggle} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

// ── Role editor view (full pane) ──────────────────────────────────────────────

interface RoleEditorProps {
  role: RoleDefinition | null; // null = new role
  allPerms: Permission[];
  allUsers: ReturnType<typeof useData>['users'];
  onSave: (name: string, description: string, permIds: string[]) => Promise<void>;
  onCancel: () => void;
}

function RoleEditor({ role, allPerms, allUsers, onSave, onCancel }: RoleEditorProps): React.ReactElement {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [activePermIds, setActivePermIds] = useState<string[]>(role?.permissions ?? []);

  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const isAdmin = !!role?.isSystemRole && role.name === 'Client Admin';
  const isSystemRole = role?.isSystemRole ?? false;
  const effectivePermIds = isAdmin ? allPerms.map(permission => permission.id) : activePermIds;
  const userCount = allUsers.filter((u) => !u.isArchived && u.role === role?.name).length;

  const handleToggle = useCallback((id: string, v: boolean) => {
    setActivePermIds(prev => togglePermissionSelection(prev, [id], v));
  }, []);

  const handleGroupToggle = useCallback((ids: string[], v: boolean) => {
    setActivePermIds(prev => togglePermissionSelection(prev, ids, v));
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || isSystemRole) return;
    if (!name.trim()) { setNameError('Role name is required.'); return; }
    if (name.trim().length < 2) { setNameError('Name must be at least 2 characters'); return; }
    setNameError(''); setSaveError(''); setSaving(true); submitting.current = true;
    try { await onSave(name.trim(), description.trim(), activePermIds); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save role. Please try again.'); }
    finally { setSaving(false); submitting.current = false; }
  };

  const totalEnabled = effectivePermIds.length;
  const totalPerms = allPerms.length;

  return (
    <motion.form onSubmit={handleSave} noValidate
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col min-w-0 w-full max-w-4xl mx-auto p-3 sm:p-6"
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4 pb-6 border-b border-gray-200 dark:border-white/[0.08] mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" aria-label="Back to roles" disabled={saving} onClick={onCancel} className="shrink-0"><ArrowLeft size={18} /></Button>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{role ? 'Edit Role' : 'Create Custom Role'}</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            {role ? 'Modify permissions and settings for this role.' : 'Define a new set of permissions for your team.'}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 order-last sm:order-none">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={isSystemRole || saving}>{saving ? 'Saving…' : role ? 'Save Changes' : 'Create Role'}</Button>
        </div>
      </div>
      {saveError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{saveError}</p>}

      {/* Role Details */}
      <div className="pb-6 shrink-0 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0">
            <label htmlFor="role-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Role Name *</label>
            <input id="role-name" required aria-invalid={!!nameError} aria-describedby={nameError ? "role-name-error" : undefined} maxLength={50} type="text" value={name} onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) setNameError(''); }} placeholder="e.g. Regional Manager" autoFocus
              disabled={isSystemRole || saving}
              className={cn(
                "w-full px-4 py-2.5 bg-white dark:bg-[#16191E] border border-gray-200 dark:border-[#262A33] text-slate-900 dark:text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm",
                isSystemRole && "bg-slate-50 dark:bg-slate-800/50 text-slate-500 cursor-not-allowed"
              )} />
            {nameError && <p id="role-name-error" role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{nameError}</p>}
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="role-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Description <span className="font-normal text-slate-400">— Optional</span></label>
            <input id="role-description" maxLength={200} disabled={isSystemRole || saving} type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this role"
              className="w-full px-4 py-2.5 bg-white dark:bg-[#16191E] border border-gray-200 dark:border-[#262A33] text-slate-900 dark:text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" />
          </div>
        </div>
        
        {role && (
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <span className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md uppercase tracking-wider",
                isSystemRole 
                  ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              )}>
                {isSystemRole ? 'System Role' : 'Custom Role'}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
              <Users size={16} />
              <span className="font-medium">{userCount} user{userCount !== 1 ? 's' : ''} assigned</span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="text-sm text-slate-600 dark:text-slate-400">
              <span className="font-medium">{totalEnabled} of {totalPerms}</span> permissions enabled
            </div>
          </div>
        )}
      </div>

      {/* Admin lock banner */}
      {isAdmin && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl mb-6 shrink-0">
          <Info size={16} className="text-slate-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The <strong>Client Admin</strong> role always has all permissions enabled and cannot be restricted. To customize access, duplicate this role and modify the copy.
          </p>
        </div>
      )}

      {/* Permission sections — scrollable */}
      <div className="space-y-4 pb-6">
        {PERM_GROUPS.map((group) => (
          <PermSection
            key={group.id}
            group={group}
            allPerms={allPerms}
            activePermIds={effectivePermIds}
            onToggle={handleToggle}
            onGroupToggle={handleGroupToggle}
            disabled={isSystemRole || saving}
          />
        ))}
      </div>
    </motion.form>
  );
}

// ── Main RolesPermissions component ──────────────────────────────────────────

interface RolesPermissionsProps {
  onViewActiveChange?: (isActive: boolean) => void;
}

export function RolesPermissions({ onViewActiveChange }: RolesPermissionsProps): React.ReactElement {
  const { tenant, userCan } = useAuth();
  const { roles, permissions, rolesLoading, rolesError, refreshRoles, users, addRole, updateRole, deleteRole } = useData();

  // view state
  const [view, setView] = useState<'list' | 'edit' | 'new'>('list');
  const [selectedRole, setSelectedRole] = useState<RoleDefinition | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  // dropdown state
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const canCreate = userCan('roles', 'canCreate');
  const canEdit = userCan('roles', 'canEdit');
  const canArchive = userCan('roles', 'canArchive');
  const canManage = canCreate || canEdit || canArchive;

  const visibleRoles = useMemo(
    () => roles.filter((r) => !r.isArchived),
    [roles],
  );

  const notify = (isActive: boolean) => onViewActiveChange?.(isActive);

  const openEdit = (role: RoleDefinition) => {
    if (role.isSystemRole || !canEdit) return;
    setSelectedRole(role);
    setView('edit');
    notify(true);
    setOpenDropdownId(null);
  };

  const openNew = () => {
    if (!canCreate) return;
    setSelectedRole(null);
    setView('new');
    notify(true);
  };

  const goList = () => {
    setView('list');
    setSelectedRole(null);
    notify(false);
  };

  const handleSave = async (name: string, description: string, permIds: string[]) => {
    if (view === 'new') {
      await addRole({ name, description, permissions: permIds, isSystemRole: false, userCount: 0 });
      toast.success(`Role "${name}" created`);
    } else if (selectedRole) {
      await updateRole(selectedRole.id, { name, description, permissions: permIds });
      toast.success('Role updated');
    }
    goList();
  };

  const handleCopy = async (role: RoleDefinition) => {
    try {
      await addRole({ name: `${role.name} (Copy)`, description: role.description, permissions: [...role.permissions], isSystemRole: false, userCount: 0 });
      toast.success(`"${role.name}" duplicated`); setOpenDropdownId(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to duplicate role.'); }
  };

  const handleDeleteConfirm = async (id: string) => {
    try {
      await deleteRole(id); toast.success('Role archived'); setDeleteConfirmId(null);
      if (view === 'edit' && selectedRole?.id === id) goList();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to archive role.'); }
  };

  useEffect(() => { setView('list'); setSelectedRole(null); onViewActiveChange?.(false); }, [tenant?.id]);

  if (rolesLoading) return <p role="status" className="p-4 text-sm">Loading roles and permissions…</p>;
  if (rolesError) return <div role="alert" className="p-4 space-y-3"><p>{rolesError}</p><Button variant="outline" onClick={() => void refreshRoles()}>Retry</Button></div>;

  // ── Editor views ─────────────────────────────────────────────────────────────

  if (view === 'edit' && selectedRole) {
    const freshRole = roles.find((r) => r.id === selectedRole.id) ?? selectedRole;
    return (
      <AnimatePresence mode="wait">
        <RoleEditor
          role={freshRole}
          allPerms={permissions}
          allUsers={users}
          onSave={handleSave}
          onCancel={goList}
        />
      </AnimatePresence>
    );
  }

  if (view === 'new') {
    return (
      <AnimatePresence mode="wait">
        <RoleEditor
          role={null}
          allPerms={permissions}
          allUsers={users}
          onSave={handleSave}
          onCancel={goList}
        />
      </AnimatePresence>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Roles &amp; Permissions</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage team access and control what users can see and do.</p>
        </div>
        {canCreate && (
          <Button onClick={openNew} className="shrink-0"><Plus size={16} /> Create Custom Role</Button>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-2xl">
        <div className="p-1.5 bg-white dark:bg-slate-800 rounded-lg shadow-sm shrink-0">
          <Shield size={16} className="text-slate-700 dark:text-slate-300" />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
          Roles allow you to control what users can see and do within the application. System roles provide foundational access levels and cannot be deleted, while Custom roles can be tailored specifically to your organization's unique requirements.{' '}
          <button className="text-slate-900 dark:text-white font-medium hover:underline underline-offset-4 transition-all">Learn more about RBAC</button>
        </p>
      </div>

      {/* Role cards grid */}
      <div className="pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleRoles.map((role, index) => {
            const roleUserCount = users.filter((u) => !u.isArchived && u.role === role.name).length;
            const enabledCount = role.isSystemRole && role.name === 'Client Admin' ? permissions.length : role.permissions?.length ?? 0;
            const isDropdownOpen = openDropdownId === role.id;
            
            return (
              <motion.div
                key={role.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.05, ease: [0.21, 0.47, 0.32, 0.98] }}
                className="group relative bg-white dark:bg-[#16191E] border border-gray-200 dark:border-[#262A33] rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-300 flex flex-col h-full"
              >
                {/* Header: Name + Menu */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm border",
                      role.isSystemRole 
                        ? "bg-slate-50 border-slate-100 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300" 
                        : "bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                    )}>
                      <Shield size={18} strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate">{role.name}</h3>
                      <div className="mt-0.5">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                          role.isSystemRole 
                            ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                        )}>
                          {role.isSystemRole ? 'System' : 'Custom'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions Dropdown */}
                  {canManage && (
                    <DropdownMenu open={isDropdownOpen} onOpenChange={open => setOpenDropdownId(current => open ? role.id : current === role.id ? null : current)}>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Actions for ${role.name}`}
                          className={cn(
                            "p-2 rounded-lg transition-colors duration-200",
                            isDropdownOpen
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                              : "text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                          )}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-48" aria-label={`Actions for ${role.name}`}>
                        <DropdownMenuItem disabled={role.isSystemRole || !canEdit} onSelect={() => openEdit(role)}>
                          <Edit2 size={14} className="text-slate-400" /> Edit Permissions
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canCreate} onSelect={() => handleCopy(role)}>
                          <Copy size={14} className="text-slate-400" /> Duplicate Role
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={role.isSystemRole || !canArchive} destructive onSelect={() => setDeleteConfirmId(role.id)}>
                          <Trash2 size={14} /> Archive Role
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Description */}
                <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mb-6 flex-1">
                  {role.description}
                </p>

                {/* Stats Footer */}
                <div className="pt-4 mt-auto border-t border-slate-100 dark:border-white/[0.04] flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                    <Users size={14} className="text-slate-400 dark:text-slate-500" />
                    {roleUserCount > 0 ? (
                      <span className="font-medium hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">{roleUserCount} user{roleUserCount !== 1 ? 's' : ''}</span>
                    ) : (
                      <span>No users</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                    <span className="font-medium">{enabledCount}</span>
                    <span className="text-slate-400">permissions</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Delete confirm modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDeleteConfirmId(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="bg-white dark:bg-[#16191E] border border-gray-200 dark:border-[#262A33] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/[0.05]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center shrink-0">
                    <Trash2 size={18} className="text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Archive Role?</h3>
                </div>
                <button onClick={() => setDeleteConfirmId(null)} className="p-2 -mr-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"><X size={18} /></button>
              </div>
              <div className="px-6 py-6">
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Archive this custom role? Reassign its users first. Archived roles can be recovered from Archived Data.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-gray-100 dark:border-white/[0.05]">
                <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">Cancel</button>
                <button onClick={() => handleDeleteConfirm(deleteConfirmId)} className="px-5 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm transition-all hover:shadow-md">Archive Role</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
