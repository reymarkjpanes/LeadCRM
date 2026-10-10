'use client';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelPrimaryActionClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';

import { useAuth } from '@/store/AuthContext';
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreateAdministrationUserSchema, UpdateAdministrationUserSchema, EMPLOYEE_EMAIL_DOMAIN } from '@leadcrm/shared';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { normalizePhInput } from '@/shared/utils/ph-phone';
import { usersService } from '@/features/tenant/administration/users/services/users.service';
import type { User } from '@/store/types';
import { groupsApi, type TenantGroup } from '@/shared/services/groups.api';

type Draft = { firstName: string; lastName: string; email: string; phone: string; role: string; jobTitle: string; status: string };
type DraftErrors = Partial<Record<keyof Draft | 'groupIds', string>>;
const makeDraft = (user?: User): Draft => ({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', email: user?.email ?? '', phone: normalizePhInput(user?.phone ?? ''), role: user?.role ?? '', jobTitle: user?.jobTitle ?? '', status: user?.status ?? 'active' });
const placeholders: Partial<Record<keyof Draft | 'groupIds', string>> = { firstName: 'e.g. Juan', lastName: 'e.g. Dela Cruz', email: 'e.g. juan.delacruz', jobTitle: 'e.g. Sales Representative' };
const labels = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone', role: 'Role', jobTitle: 'Job Title', status: 'Status' };

export function UserPanel({ user, roles, canEdit, onSaved, onClose, initiallyEditing = false }: {
  initiallyEditing?: boolean;
  user?: User; roles: { id: string; name: string }[]; canEdit: boolean;
  onSaved: (user: User) => void; onClose: () => void;
}) {
  const { userCan, user: actor } = useAuth();
  const canManageGroups = actor?.role === 'Client Admin' && userCan('groups', 'canEdit');
  const [groupOptions, setGroupOptions] = useState<TenantGroup[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>(() => user?.groups?.map(group => group.id) ?? []);
  const [groupError, setGroupError] = useState('');
  const [groupsLoading, setGroupsLoading] = useState(false);
  useEffect(() => {
    if (!canManageGroups) return;
    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      setGroupsLoading(true);
      groupsApi.getAll().then(response => {
        if (active && current === request) { setGroupOptions(response.data); setGroupError(''); }
      }).catch(() => {
        if (active && current === request) setGroupError('Groups could not load. Manage memberships in the Groups tab.');
      }).finally(() => { if (active && current === request) setGroupsLoading(false); });
    };
    load();
    window.addEventListener('leadcrm:groups-changed', load);
    return () => { active = false; window.removeEventListener('leadcrm:groups-changed', load); };
  }, [canManageGroups, actor?.tenantId]);
  const canAssign = userCan('roles', 'canAssign'), canActivate = userCan('users', 'canActivate');
  const canChange = canEdit || (!!user && (canAssign || canActivate));
  const [saved, setSaved] = useState(user);
  const [editing, setEditing] = useState(!user || (canChange && initiallyEditing));
  const [draft, setDraft] = useState(() => makeDraft(user));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const creating = !saved;
  const observedUser = useRef(user);
  useEffect(() => {
    if (editing || !user || observedUser.current === user) return;
    observedUser.current = user;
    setSaved(user); setDraft(makeDraft(user)); setGroupIds(user.groups?.map(group => group.id) ?? []);
  }, [user, editing]);

  const parse = (value: Draft) => creating
    ? CreateAdministrationUserSchema.safeParse({ firstName: value.firstName, lastName: value.lastName, email: `${value.email.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`, phone: value.phone, role: value.role, jobTitle: value.jobTitle, ...(canManageGroups && groupIds.length ? { groupIds } : {}) })
    : UpdateAdministrationUserSchema.safeParse({ ...(canEdit ? { firstName: value.firstName, lastName: value.lastName, jobTitle: value.jobTitle } : {}),
      ...(canEdit && value.phone !== normalizePhInput(saved?.phone ?? '') ? { phone: value.phone } : {}),
      ...(canManageGroups && value.status === 'active' && [...groupIds].sort().join(',') !== (saved?.groups ?? []).map(group => group.id).sort().join(',') ? { groupIds } : {}),
      ...(value.role !== saved?.role ? { role: value.role } : {}),
      ...(value.status !== saved?.status ? { status: value.status.toUpperCase() } : {}),
    });
  const validation = (value: Draft) => {
    const result = parse(value);
    const next: DraftErrors = {};
    if (!result.success) for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof Draft | 'groupIds';
      if (!next[field]) next[field] = issue.message;
    }
    if (creating && (!/^[a-zA-Z0-9._+\-]+$/.test(value.email.trim()) || /[\u0000-\u001f\u007f-\u009f]/.test(value.email))) next.email = 'Enter an email username using letters, numbers, dots, underscores, hyphens or plus signs.';
    if ((creating || value.role !== saved?.role) && value.role && !roles.some(role => role.name === value.role)) next.role = 'Select an active custom role.';
    return next;
  };
  const change = (key: keyof Draft, value: string, interact = false) => {
    const next = { ...draft, [key]: value };
    if (key === 'status' && value !== 'active') {
      setGroupIds(saved?.groups?.map(group => group.id) ?? []);
      setErrors(prev => ({ ...prev, groupIds: undefined }));
    }
    setDraft(next);
    if (touched[key] || errors[key] || interact) {
      setTouched(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: validation(next)[key] }));
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canChange || locked.current) return;
    const invalid = validation(draft);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      form.current?.querySelector<HTMLElement>(`[id="user-${Object.keys(invalid)[0]}"]`)?.focus();
      return;
    }
    const result = parse(draft);
    if (!result.success) return;
    locked.current = true; setBusy(true);
    try {
      const response = creating ? await usersService.create(result.data as Partial<User>)
        : await usersService.update(saved!.id, result.data as Partial<User>);
      const persisted = response.data!;
      onSaved(persisted);
      toast.success(creating ? 'User created successfully.' : 'User updated');
      if (creating) onClose();
      else { setSaved(persisted); setGroupIds(persisted.groups?.map(group => group.id) ?? []); setDraft(makeDraft(persisted)); setEditing(false); }
    } catch (reason) {
      const error = reason as Error & { fieldErrors?: Record<string, string[]>; status?: number; code?: string };
      if (error.fieldErrors) setErrors(Object.fromEntries(Object.entries(error.fieldErrors).map(([key, messages]) => [key, messages[0]])));
      else if (creating && (error.status === 409 || error.code === 'EMPLOYEE_ACCOUNT_REQUIRED')) setErrors({ email: error.message });
      else if (/role/i.test(error.message)) setErrors({ role: error.message });
      else toast.error(error.message || 'Unable to save user.');
    } finally { locked.current = false; setBusy(false); }
  };
  const resetPassword = async () => {
    if (!saved || locked.current) return;
    locked.current = true; setBusy(true);
    try { await usersService.sendPasswordReset(saved.id); toast.success('Password reset email requested.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to send recovery email.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const input = (key: keyof Draft, required = false) => {
    const id = `user-${key}`;
    const error = errors[key];
    const props = { id, placeholder: placeholders[key], value: draft[key], disabled: busy || !canEdit || (key === 'email' && !creating), required,
      'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined,
      onBlur: () => { setTouched(prev => ({ ...prev, [key]: true })); setErrors(prev => ({ ...prev, [key]: validation(draft)[key] })); },
      className: `w-full min-w-0 rounded-xl border px-3 py-2.5 text-sm bg-white dark:bg-slate-800 ${error ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`,
    };
    return <div key={key} className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 dark:text-slate-300">{labels[key]}{required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}</label>
      {key === 'phone' ? <PhilippinePhoneInput id={id} required={required} disabled={busy || !canEdit} value={draft.phone} onChange={value => change(key, value, true)} onBlur={props.onBlur} error={error} />
        : key === 'role' || key === 'status' ? <select {...props} disabled={busy || (key === 'role' && !canAssign) || (key === 'status' && !canActivate) || (key === 'role' && !!saved && !roles.some(role => role.name === saved.role))} onChange={event => change(key, event.target.value, true)}>
          {key === 'role' ? <><option value="">Select role</option>{saved && !roles.some(role => role.name === saved.role) && <option value={saved.role}>{saved.role}</option>}{roles.map(role => <option key={role.id} value={role.name}>{role.name}</option>)}</>
            : <><option value="active">Active</option><option value="inactive">Inactive</option>{draft.status === 'pending' && <option value="pending">Pending</option>}</>}
        </select> : key === 'email' && creating ? <div className={`flex min-w-0 overflow-hidden rounded-xl border bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 ${error ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`}>
          <input {...props} type="text" autoCapitalize="none" autoCorrect="off" maxLength={64}
            className="w-full min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
            onChange={event => { if (!event.target.value.includes('@')) change(key, event.target.value); else setErrors(prev => ({ ...prev, email: 'Enter only the username, without @ or a domain.' })); }}
            onPaste={event => { if (event.clipboardData.getData('text').includes('@')) { event.preventDefault(); setErrors(prev => ({ ...prev, email: 'Enter only the username, without @ or a domain.' })); } }} />
          <span className="shrink-0 border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-2.5 text-xs sm:text-sm text-slate-500">@{EMPLOYEE_EMAIL_DOMAIN}</span>
        </div> : <input {...props} type={key === 'email' ? 'email' : 'text'} maxLength={key === 'email' ? 254 : 100} onChange={event => change(key, event.target.value)} />}
      {key !== 'phone' && error && <p id={`${id}-error`} className="text-xs text-red-500" role="alert">{error}</p>}
    </div>;
  };

  return <SlidingDrawer isOpen onClose={() => { if (!busy) onClose(); }} title={creating ? 'New User' : 'User Details'} subtitle={creating ? 'Complete the user details below.' : undefined}>
    {editing ? <form ref={form} onSubmit={save} noValidate className="flex h-full min-h-0 flex-col text-slate-900 dark:text-white">
      <div className={panelBodyClass + " space-y-6"}>
        <section className="space-y-4"><PanelSectionHeading number={1}>Basic Information</PanelSectionHeading><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('firstName', true)}{input('lastName', true)}{input('email', true)}{input('phone', creating)}</div></section>
        <section className="space-y-4"><PanelSectionHeading number={2}>Organization</PanelSectionHeading>{input('role', true)}<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('jobTitle')}{!creating && input('status')}</div>
          <fieldset disabled={busy || groupsLoading || !canManageGroups || !!groupError || draft.status !== 'active'} className="space-y-2">
            <legend className="text-xs font-semibold">Groups</legend>
            {canManageGroups && !groupError ? groupOptions.map(group => <label key={group.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={groupIds.includes(group.id)} onChange={event => { setGroupIds(ids => event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id)); setErrors(prev => ({ ...prev, groupIds: undefined })); }} />{group.name}
            </label>) : <p className="text-sm">{saved?.groups?.map(group => group.name).join(', ') || 'No groups assigned'}</p>}
            {groupError && <p role="alert" className="text-xs text-red-500">{groupError}</p>}
            {canManageGroups && groupsLoading && <p className="text-xs text-slate-500" role="status">Loading available groups…</p>}
            {canManageGroups && !groupsLoading && !groupError && !groupOptions.length && <p className="text-sm">No groups have been created.</p>}
            {errors.groupIds && <p role="alert" className="text-xs text-red-500">{errors.groupIds}</p>}
            {draft.status !== 'active' && <p className="text-xs text-slate-500">Activate this user to change memberships. Existing groups are retained while inactive.</p>}
            <p className="text-xs text-slate-500">The same memberships are used by workflow assignment. Manage available groups in Team Management → Groups.</p>
          </fieldset>
        </section>
      </div>
      <div className={panelFooterClass + " justify-end"}>
        <button type="button" disabled={busy} onClick={() => { if (creating) onClose(); else { setDraft(makeDraft(saved)); setGroupIds(saved?.groups?.map(group => group.id) ?? []); setErrors({}); setTouched({}); setEditing(false); } }} className={panelSecondaryActionClass}>Cancel</button>
        <button disabled={busy} type="submit" className={panelPrimaryActionClass}>{busy && <Loader2 className="animate-spin" size={16} />}{creating ? 'Create User' : 'Save Changes'}</button>
      </div>
    </form> : <div className="flex h-full min-h-0 flex-col text-slate-900 dark:text-white">
      <div className={panelBodyClass}><h3 className="font-semibold mb-5">Personal Information</h3><dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">{(Object.keys(labels) as (keyof Draft)[]).map(key => <div key={key} className="min-w-0"><dt className="text-xs text-slate-500">{labels[key]}</dt><dd className="text-sm mt-1 break-words">{saved?.[key] || '—'}</dd></div>)}</dl><div className="mt-5"><p className="text-xs text-slate-500">Groups</p><p className="mt-1 text-sm">{saved?.groups?.map(group => group.name).join(', ') || 'No groups assigned'}</p></div></div>
      {canChange && <div className={panelFooterClass}>
        <button disabled={busy} onClick={() => setEditing(true)} className={panelPrimaryActionClass}>Edit User</button>
        <button disabled={busy || !canEdit || saved?.status !== 'active'} onClick={resetPassword} className={panelSecondaryActionClass}>{busy ? 'Sending…' : 'Send Password Reset'}</button>
      </div>}
    </div>}
  </SlidingDrawer>;
}
