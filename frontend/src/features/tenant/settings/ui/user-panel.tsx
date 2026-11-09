'use client';
import { getNameDigitError } from '@/shared/utils/name-digit-error';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelPrimaryActionClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';

import { useAuth } from '@/store/AuthContext';
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useEmailAvailability } from '@/shared/hooks/use-email-availability';
import { toast } from '@/shared/utils/toast';
import { CreateAdministrationUserSchema, UpdateAdministrationUserSchema, EmployeeEmailSchema, StaffEmailSchema } from '@leadcrm/shared';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { normalizePhInput } from '@/shared/utils/ph-phone';
import { usersService } from '@/features/tenant/administration/users/services/users.service';
import type { User } from '@/store/types';
import { groupsApi, type TenantGroup } from '@/shared/services/groups.api';
import { InlineEditRows, type InlineRowDef } from '@/shared/components/crm/inline-edit-rows';
import { RecordSection } from '@/shared/components/crm/record-section';
import { RowActionsMenu, type RowActionItem } from '@/shared/components/data-grid/row-actions-menu';
import { UserAvatar, administrationAvatarUrl } from '@/shared/components/user-avatar';
import { CheckboxDropdownSelect } from '@/shared/components/ui/checkbox-dropdown-select';
import { Input } from '@/shared/components/ui/input';

type Draft = { firstName: string; lastName: string; email: string; phone: string; role: string; jobTitle: string };
type DraftErrors = Partial<Record<keyof Draft | 'groupIds', string>>;
const makeDraft = (): Draft => ({ firstName: '', lastName: '', email: '', phone: '', role: '', jobTitle: '' });
const placeholders: Partial<Record<keyof Draft | 'groupIds', string>> = { firstName: 'e.g. Juan', lastName: 'e.g. Dela Cruz', email: 'e.g. juan@camxian.com', jobTitle: 'e.g. Sales Representative' };
const labels = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone', role: 'Role', jobTitle: 'Job Title' };

export function UserPanel({ user, roles, canEdit, onSaved, onClose, actions = [] }: {
  actions?: RowActionItem[];
  user?: User; roles: { id: string; name: string }[]; canEdit: boolean;
  onSaved: (user: User) => void; onClose: () => void;
}) {
  const { userCan, user: actor } = useAuth();
  useReadRecordNotifications('User', user?.id, !!user && user.tenantId === actor?.tenantId && userCan('users', 'canView'));
  const canManageGroups = canEdit && actor?.role === 'Client Admin' && userCan('groups', 'canEdit');
  const [groupOptions, setGroupOptions] = useState<TenantGroup[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
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
  const canAssign = userCan('roles', 'canAssign');
  const [saved, setSaved] = useState(user);
  const [draft, setDraft] = useState(makeDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const creating = !user;
  const emailCheck = useEmailAvailability(draft.email, 'users', creating && canEdit && canAssign);
  useEffect(() => {
    if (user) setSaved(user);
  }, [user]);

  const parse = (value: Draft) => CreateAdministrationUserSchema.safeParse({ ...value, ...(canManageGroups && groupIds.length ? { groupIds } : {}) });
  const validation = (value: Draft) => {
    const result = parse(value);
    const next: DraftErrors = {};
    if (!result.success) for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof Draft | 'groupIds';
      if (!next[field]) next[field] = issue.message;
    }
    for (const field of ['firstName', 'lastName'] as const) {
      const error = getNameDigitError(field, value[field]);
      if (error) next[field] = error;
    }
    if (creating && StaffEmailSchema.safeParse(value.email).success && actor?.role !== 'Client Admin' && !EmployeeEmailSchema.safeParse(value.email).success) next.email = 'Only Client Admin users can approve an external staff email.';
    if (value.role && (!roles.some(role => role.name === value.role) ||
      (value.role === 'Client Admin' && (!creating || actor?.role !== 'Client Admin')))) next.role = 'Select an active role.';
    return next;
  };
  const change = (key: keyof Draft, value: string, interact = false) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (key === 'email' || touched[key] || errors[key] || interact) {
      setTouched(prev => ({ ...prev, [key]: true }));
      setErrors(prev => ({ ...prev, [key]: validation(next)[key] }));
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!creating || !canEdit || !canAssign || locked.current) return;
    const invalid = validation(draft);
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      form.current?.querySelector<HTMLElement>(`[id="user-${Object.keys(invalid)[0]}"]`)?.focus();
      return;
    }
    const result = parse(draft);
    if (!result.success) return;
    if (!emailCheck.confirm(result.data.email)) return;
    locked.current = true; setBusy(true);
    try {
      const response = await usersService.create(result.data as Partial<User>);
      const persisted = response.data!;
      onSaved(persisted);
      toast.success('User created.');
      onClose();
    } catch (reason) {
      const error = reason as Error & { fieldErrors?: Record<string, string[]>; status?: number; code?: string };
      if (error.status === 409) emailCheck.reject('EMAIL_IN_USE');
      if (error.fieldErrors) setErrors(Object.fromEntries(Object.entries(error.fieldErrors).map(([key, messages]) => [key, messages[0]])));
      else if (creating && (error.status === 409 || error.code === 'EMPLOYEE_ACCOUNT_REQUIRED')) setErrors({ email: error.message });
      else if (/role/i.test(error.message)) setErrors({ role: error.message });
      else toast.error(error.message || 'Unable to save user.');
    } finally { locked.current = false; setBusy(false); }
  };
  const resetPassword = async () => {
    if (!saved || !canEdit || saved.status !== 'active' || locked.current) return;
    locked.current = true; setBusy(true); setResetting(true);
    try { await usersService.sendPasswordReset(saved.id); toast.success('Password reset email requested.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to send recovery email.'); }
    finally { locked.current = false; setBusy(false); setResetting(false); }
  };
  const canChangeRole = canAssign && !!saved && roles.some(role => role.name === saved.role);
  const canChangeGroups = canManageGroups && saved?.status === 'active';
  const saveField = async (field: string, value: string | string[]) => {
    const permitted = field === 'role' ? canChangeRole : field === 'groupIds' ? canChangeGroups
      : ['firstName', 'lastName', 'phone'].includes(field) && canEdit;
    if (!saved || !permitted) throw new Error('You do not have permission to edit this field.');
    if (locked.current) throw new Error('Another request is in progress. Please try again.');
    if (field === 'role' && !roles.some(role => role.name === value)) throw new Error('Select an active custom role.');
    if (field === 'groupIds' && (groupsLoading || groupError)) throw new Error(groupError || 'Wait for available groups to load.');
    const result = UpdateAdministrationUserSchema.safeParse({ [field]: field === 'groupIds' && typeof value === 'string' ? JSON.parse(value) : value });
    if (!result.success) throw new Error(result.error.issues[0].message);
    locked.current = true; setBusy(true);
    try {
      const response = await usersService.update(saved.id, result.data as Partial<User>);
      if (!response.data) throw new Error('Unable to save user.');
      setSaved(response.data);
      onSaved(response.data);
      toast.success('User updated.');
    } catch (reason) {
      const error = reason as Error & { fieldErrors?: Record<string, string[]> };
      throw new Error(error.fieldErrors?.[field]?.[0] || error.message || 'Unable to save field.');
    } finally { locked.current = false; setBusy(false); }
  };
  const profileRow = (field: 'firstName' | 'lastName' | 'phone'): InlineRowDef => ({
    label: labels[field], value: field === 'phone' ? normalizePhInput(saved?.phone ?? '') : saved?.[field],
    displayValue: field === 'phone' ? saved?.phone : undefined, apiField: canEdit ? field : undefined,
    required: field === 'firstName' || field === 'lastName', alwaysVisible: true, preserveWhitespace: true,
  });
  const basicRows: InlineRowDef[] = [profileRow('firstName'), profileRow('lastName'),
    { label: 'Email', value: saved?.email, alwaysVisible: true },
    { ...profileRow('phone'), renderEditor: ({ value, onChange, disabled, error, onSave, onCancel }) => <div onKeyDownCapture={event => {
      if (!disabled && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') onSave(); else onCancel();
      }
    }}>
      <label className="sr-only" htmlFor="user-inline-phone">Phone</label>
      <PhilippinePhoneInput id="user-inline-phone" value={value} onChange={onChange} disabled={disabled} error={error} showError={false}
        className="min-w-0 [&>div]:flex-wrap [&_input]:w-full [&_input]:basis-full sm:[&_input]:w-auto sm:[&_input]:basis-0" />
      {error && <span id="user-inline-phone-error" className="sr-only">{error}</span>}
    </div> },
  ];
  const organizationRows: InlineRowDef[] = [
    { label: 'Role', value: saved?.role, apiField: canChangeRole ? 'role' : undefined, type: 'select', options: roles.map(role => role.name), alwaysVisible: true },
    { label: 'Job Title', value: saved?.jobTitle, alwaysVisible: true },
    { label: 'Login Security', value: saved?.securityLockedAt ? 'Locked — contact an administrator' : 'Unlocked', alwaysVisible: true },
    { label: 'Status', value: saved?.status, displayValue: saved?.status ? saved.status[0].toUpperCase() + saved.status.slice(1) : '—', alwaysVisible: true },
    { label: 'Groups', value: JSON.stringify(saved?.groups?.map(group => group.id) ?? []),
      displayValue: saved?.groups?.map(group => group.name).join(', ') || 'No groups assigned',
      apiField: canChangeGroups ? 'groupIds' : undefined, alwaysVisible: true,
      editorDisabled: groupsLoading || !!groupError, editorError: groupError,
      renderEditor: ({ value, onChange, disabled, error, onCancel }) => <fieldset aria-label="Groups" aria-invalid={!!error} disabled={disabled || groupsLoading || !!groupError}
        className="min-w-0 space-y-2 text-left" onKeyDown={event => { if (!disabled && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
        {groupOptions.map(group => <label key={group.id} className="flex min-w-0 items-start gap-2 [overflow-wrap:anywhere]">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={(JSON.parse(value) as string[]).includes(group.id)} onChange={event => {
            const ids = JSON.parse(value) as string[];
            onChange(JSON.stringify(event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id)));
          }} /><span className="min-w-0">{group.name}</span>
        </label>)}
        {groupsLoading && <p role="status">Loading available groups…</p>}
        {!groupsLoading && !groupError && !groupOptions.length && <p>No groups have been created.</p>}
      </fieldset> },
  ];
  const input = (key: keyof Draft, required = false) => {
    const id = `user-${key}`;
    const error = key === 'email' ? emailCheck.error || errors.email : getNameDigitError(key, draft[key]) ?? errors[key];
    const props = { id, placeholder: placeholders[key], value: draft[key], disabled: busy || !canEdit || (key === 'email' && !creating), required,
      'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined,
      onBlur: () => { setTouched(prev => ({ ...prev, [key]: true })); setErrors(prev => ({ ...prev, [key]: validation(draft)[key] })); if (key === 'email') emailCheck.retry(); },
      className: `w-full min-w-0 rounded-xl border px-3 py-2.5 text-sm ${error ? 'border-red-500' : ''}`,
    };
    return <div key={key} className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 dark:text-slate-300">{labels[key]}{required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}</label>
      {key === 'phone' ? <PhilippinePhoneInput id={id} required={required} disabled={busy || !canEdit} value={draft.phone} onChange={value => change(key, value, true)} onBlur={props.onBlur} error={error} />
        : key === 'role' ? <select {...props} disabled={busy || !canAssign} onChange={event => change(key, event.target.value, true)}>
          <option value="">Select role</option>{roles.map(role => <option key={role.id} value={role.name}>{role.name}</option>)}
        </select> : key === 'email' ? <div className="relative">
          <Input {...props} className={props.className + ' pr-10'} type="email" autoCapitalize="none" autoCorrect="off" maxLength={254} onChange={event => change(key, event.target.value)} />
          {emailCheck.available && !error && <Check size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400" />}
        </div> : <Input {...props} type="text" maxLength={100} onChange={event => change(key, event.target.value)} />}
      {key !== 'phone' && error && <p id={`${id}-error`} className="text-xs text-red-500" role="alert">{error}</p>}
    </div>;
  };

  return <SlidingDrawer isOpen onClose={() => { if (!busy) onClose(); }} title={creating ? 'New User' : 'User Details'} subtitle={creating ? 'Complete the user details below.' : undefined}
    headerContent={saved && <div className="flex min-w-0 items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
        <UserAvatar user={{ ...saved, avatarUrl: administrationAvatarUrl(saved) }} />
      </div>
      <div className="min-w-0">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-primary">USER</span>
        <h2 className="mt-1 text-xl font-bold tracking-tight [overflow-wrap:anywhere]">{saved.firstName} {saved.lastName}</h2>
        <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{saved.role}</p>
      </div>
    </div>}
    headerActions={!creating && actions.length > 0 && <RowActionsMenu label="User actions" position="right" actions={actions.map(action => ({ ...action, disabled: action.disabled || busy, disabledReason: action.disabledReason || (busy ? 'Wait for the current request to finish.' : undefined) }))} />}>
    {creating ? <form ref={form} onSubmit={save} noValidate className="flex h-full min-h-0 flex-col text-slate-900 dark:text-white">
      <div className={panelBodyClass + " space-y-6"}>
        <section className="space-y-4"><PanelSectionHeading number={1}>Basic Information</PanelSectionHeading><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('firstName', true)}{input('lastName', true)}{input('email', true)}{input('phone', creating)}</div></section>
        <section className="space-y-4"><PanelSectionHeading number={2}>Organization</PanelSectionHeading>{input('role', true)}<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{input('jobTitle')}</div>
          <fieldset disabled={busy || groupsLoading || !canManageGroups || !!groupError} className="space-y-2">
            <legend className="text-xs font-semibold">Groups</legend>
            {canManageGroups ? <CheckboxDropdownSelect id="user-groupIds" values={groupIds} options={groupOptions.map(group => ({ value: group.id, label: group.name }))}
              onChange={ids => { setGroupIds(ids); setErrors(prev => ({ ...prev, groupIds: undefined })); }}
              placeholder="Select groups..." ariaLabel="Groups" disabled={busy || groupsLoading || !!groupError} emptyMessage="No groups have been created." />
              : <p className="text-sm">{saved?.groups?.map(group => group.name).join(', ') || 'No groups assigned'}</p>}
            {groupError && <p role="alert" className="text-xs text-red-500">{groupError}</p>}
            {canManageGroups && groupsLoading && <p className="text-xs text-slate-500" role="status">Loading available groups…</p>}
            {errors.groupIds && <p role="alert" className="text-xs text-red-500">{errors.groupIds}</p>}
          </fieldset>
        </section>
      </div>
      <div className={panelFooterClass + " justify-end"}>
        <button type="button" disabled={busy} onClick={onClose} className={panelSecondaryActionClass}>Cancel</button>
        <button disabled={busy || emailCheck.blocked} type="submit" className={panelPrimaryActionClass}>{busy && <Loader2 className="animate-spin" size={16} />}Create User</button>
      </div>
    </form> : <div className="flex h-full min-h-0 flex-col text-slate-900 dark:text-white">
      <div className={panelBodyClass + ' space-y-3'}>
        <RecordSection title="Basic Information">{basicRows.map(row => <InlineEditRows key={row.label} rows={[row]} canEdit={!!row.apiField} onSave={saveField} />)}</RecordSection>
        <RecordSection title="Organization">{organizationRows.map(row => <InlineEditRows key={row.label} rows={[row]} canEdit={!!row.apiField} onSave={saveField} />)}</RecordSection>
      </div>
      <div className={panelFooterClass}>
        <button type="button" disabled={busy || !canEdit || saved?.status !== 'active'} onClick={resetPassword} className={panelSecondaryActionClass}>{resetting ? 'Sending…' : 'Send Password Reset'}</button>
      </div>
    </div>}
  </SlidingDrawer>;
}
