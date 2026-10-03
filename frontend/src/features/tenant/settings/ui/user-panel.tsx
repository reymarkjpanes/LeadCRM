'use client';

import { useAuth } from '@/store/AuthContext';
import React, { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreateAdministrationUserSchema, UpdateAdministrationUserSchema, EMPLOYEE_EMAIL_DOMAIN } from '@leadcrm/shared';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { normalizePhInput } from '@/shared/utils/ph-phone';
import { usersService } from '@/features/tenant/administration/users/services/users.service';
import type { User } from '@/store/types';

type Draft = { firstName: string; lastName: string; email: string; phone: string; role: string; jobTitle: string; department: string; status: string };
const makeDraft = (user?: User): Draft => ({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', email: user?.email ?? '', phone: normalizePhInput(user?.phone ?? ''), role: user?.role ?? '', jobTitle: user?.jobTitle ?? '', department: user?.department ?? '', status: user?.status ?? 'active' });
const placeholders: Partial<Record<keyof Draft, string>> = { firstName: 'e.g. Juan', lastName: 'e.g. Dela Cruz', email: 'e.g. juan.delacruz', jobTitle: 'e.g. Sales Representative', department: 'e.g. Sales' };
const labels = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone', role: 'Role', jobTitle: 'Job Title', department: 'Department', status: 'Status' };

export function UserPanel({ user, roles, canEdit, onSaved, onClose, initiallyEditing = false }: {
  initiallyEditing?: boolean;
  user?: User; roles: { id: string; name: string }[]; canEdit: boolean;
  onSaved: (user: User) => void; onClose: () => void;
}) {
  const { userCan } = useAuth();
  const canAssign = userCan('roles', 'canAssign'), canActivate = userCan('users', 'canActivate');
  const canChange = canEdit || (!!user && (canAssign || canActivate));
  const [saved, setSaved] = useState(user);
  const [editing, setEditing] = useState(!user || (canChange && initiallyEditing));
  const [draft, setDraft] = useState(() => makeDraft(user));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const creating = !saved;

  const parse = (value: Draft) => creating
    ? CreateAdministrationUserSchema.safeParse({ firstName: value.firstName, lastName: value.lastName, email: `${value.email.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`, phone: value.phone, role: value.role, jobTitle: value.jobTitle, department: value.department })
    : UpdateAdministrationUserSchema.safeParse({ ...(canEdit ? { firstName: value.firstName, lastName: value.lastName, jobTitle: value.jobTitle, department: value.department } : {}),
      ...(canEdit && value.phone !== normalizePhInput(saved?.phone ?? '') ? { phone: value.phone } : {}),
      ...(value.role !== saved?.role ? { role: value.role } : {}),
      ...(value.status !== saved?.status ? { status: value.status.toUpperCase() } : {}),
    });
  const validation = (value: Draft) => {
    const result = parse(value);
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!result.success) for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof Draft;
      if (!next[field]) next[field] = issue.message;
    }
    if (creating && (!/^[a-zA-Z0-9._+\-]+$/.test(value.email.trim()) || /[\u0000-\u001f\u007f-\u009f]/.test(value.email))) next.email = 'Enter an email username using letters, numbers, dots, underscores, hyphens or plus signs.';
    if ((creating || value.role !== saved?.role) && value.role && !roles.some(role => role.name === value.role)) next.role = 'Select an active custom role.';
    return next;
  };
  const change = (key: keyof Draft, value: string, interact = false) => {
    const next = { ...draft, [key]: value };
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
      toast.success(creating ? 'User created' : 'User updated');
      if (creating) onClose();
      else { setSaved(persisted); setDraft(makeDraft(persisted)); setEditing(false); }
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
    try { await usersService.sendPasswordReset(saved.id); toast.success('Password reset email sent.'); }
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
    {editing ? <form ref={form} onSubmit={save} noValidate className="flex flex-col min-h-full text-slate-900 dark:text-white">
      <div className="p-4 sm:p-6 space-y-6 flex-1">
        <section className="space-y-4"><h3 className="font-semibold">1. Basic Information</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('firstName', true)}{input('lastName', true)}{input('email', true)}{input('phone', creating)}</div></section>
        <section className="space-y-4"><h3 className="font-semibold">2. Organization</h3>{input('role', true)}<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('jobTitle')}{input('department')}{!creating && input('status')}</div></section>
      </div>
      <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 p-4 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={() => { if (creating) onClose(); else { setDraft(makeDraft(saved)); setErrors({}); setTouched({}); setEditing(false); } }} className="px-4 py-2 text-sm">Cancel</button>
        <button disabled={busy} type="submit" className="flex items-center gap-2 rounded-lg px-4 py-2 bg-blue-600 text-white text-sm disabled:opacity-50">{busy && <Loader2 className="animate-spin" size={16} />}{creating ? 'Create User' : 'Save Changes'}</button>
      </div>
    </form> : <div className="flex flex-col min-h-full text-slate-900 dark:text-white">
      <div className="p-4 sm:p-6 flex-1"><h3 className="font-semibold mb-5">Personal Information</h3><dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">{(Object.keys(labels) as (keyof Draft)[]).map(key => <div key={key} className="min-w-0"><dt className="text-xs text-slate-500">{labels[key]}</dt><dd className="text-sm mt-1 break-words">{saved?.[key] || '—'}</dd></div>)}</dl></div>
      {canChange && <div className="sticky bottom-0 bg-white dark:bg-slate-900 p-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-3">
        <button disabled={busy} onClick={() => setEditing(true)} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm">Edit User</button>
        <button disabled={busy || !canEdit || saved?.status !== 'active'} onClick={resetPassword} className="border rounded-lg px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Send Password Reset'}</button>
      </div>}
    </div>}
  </SlidingDrawer>;
}
