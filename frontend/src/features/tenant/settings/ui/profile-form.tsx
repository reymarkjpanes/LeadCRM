'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Pencil, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, isPhMobileInput, PH_MOBILE_ERROR, PROFILE_FIELD_LIMIT_ERRORS, PROFILE_FIELD_LIMITS, ProfilePhoneInputSchema, SelfProfileFieldSchemas, UpdateSelfProfileSchema } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { authApi } from '@/shared/services/auth.api';
import { UserAvatar } from '@/shared/components/user-avatar';
import { normalizePhInput } from '@/shared/utils/ph-phone';
import { AvatarCropDialog } from './avatar-crop-dialog';

const fields = [
  ['firstName', 'First Name'], ['lastName', 'Last Name'], ['phone', 'Phone Number'],
  ['jobTitle', 'Job Title'],
] as const;
type Draft = Record<typeof fields[number][0], string>;

export function ProfileForm() {
  const { user, tenant, updateProfile, applyAuthUser } = useAuth();
  const saved = (): Draft => Object.fromEntries(fields.map(([key]) => [key, key === 'phone' ? normalizePhInput(user?.phone ?? '') : user?.[key] ?? ''])) as Draft;
  const [draft, setDraft] = useState<Draft>(saved);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const busy = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) { setDraft(saved()); setFieldErrors({}); } }, [user, editing]);
  useEffect(() => { setEditing(false); setFile(null); setFieldErrors({}); }, [user?.id]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || busy.current) return;
    const parsed = UpdateSelfProfileSchema.safeParse(draft);
    const phoneInput = ProfilePhoneInputSchema.safeParse(draft.phone);
    if (!parsed.success || !phoneInput.success) {
      const errors: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.flatMap(issue => issue.path.length ? [[String(issue.path[0]), issue.message]] : []));
      if (!phoneInput.success) errors.phone = phoneInput.error.issues[0].message;
      setFieldErrors(errors);
      return;
    }
    if (Object.values(fieldErrors).some(Boolean)) return;
    setFieldErrors({});
    busy.current = true;
    setSaving(true);
    try {
      await updateProfile(parsed.data);
      setEditing(false);
      toast.success('Profile updated successfully.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save profile.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const selectFile = (selected?: File) => {
    if (!selected) return;
    if (!AVATAR_MIME_TYPES.includes(selected.type as typeof AVATAR_MIME_TYPES[number])) { toast.error('Choose a JPEG, PNG, or WebP image.'); return; }
    if (selected.size > AVATAR_MAX_BYTES || selected.size === 0) { toast.error('Choose an image no larger than 5 MB.'); return; }
    const probe = new Image();
    const url = URL.createObjectURL(selected);
    probe.onload = () => {
      URL.revokeObjectURL(url);
      if (probe.naturalWidth * probe.naturalHeight > 25_000_000) { toast.error('Choose an image smaller than 25 megapixels.'); return; }
      setFile(selected);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); toast.error('The selected file is not a valid image.'); };
    probe.src = url;
  };
  return <div className="w-full space-y-6">
    <div className="bg-card border border-gray-200 dark:border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="h-20 bg-gradient-to-r from-[#25313D] to-[#384653]" />
      <div className="px-5 pb-5">
        <div className="flex items-end justify-between -mt-8 relative">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-white bg-primary flex items-center justify-center text-white font-bold"><UserAvatar user={user} /></div>
            <button type="button" disabled={!editing || saving} onClick={() => picker.current?.click()} aria-label="Change profile photo"
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-white border flex items-center justify-center text-slate-600 disabled:opacity-50"><Camera size={13} /></button>
            <input ref={picker} type="file" accept={AVATAR_MIME_TYPES.join(',')} className="hidden" aria-label="Choose profile picture" disabled={!editing || saving}
              onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          <span className="flex gap-1 items-center text-xs text-primary"><Shield size={12} />{user?.role}</span>
        </div>
        <h2 className="mt-3 text-sm font-bold">{user?.firstName} {user?.lastName}</h2>
        <p className="text-xs text-slate-500">{tenant?.name}</p>
      </div>
    </div>
    <form noValidate onSubmit={save} className="bg-card border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Personal Information</h3><p className="text-xs text-slate-500 mt-1">Your name and contact details visible to teammates</p></div>
        {!editing && <button type="button" onClick={() => { setDraft(saved()); setEditing(true); }} className="flex items-center gap-1 border rounded-lg px-3 py-2 text-sm"><Pencil size={13} />Edit</button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(([key, label]) => <div key={key}>
          <label htmlFor={`profile-${key}`} className="block text-xs font-semibold text-slate-500 mb-1">{label}{(key === 'firstName' || key === 'lastName') && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}</label>
          <div className={key === 'phone' ? 'flex min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-muted' : undefined}>
            {key === 'phone' && <span aria-hidden="true" className="flex shrink-0 items-center border-r border-slate-200 dark:border-slate-700 px-3 text-sm text-slate-500">+63</span>}
            <input id={`profile-${key}`} aria-label={label} value={draft[key]} disabled={!editing || saving} required={key === 'firstName' || key === 'lastName'}
              type={key === 'phone' ? 'tel' : 'text'} inputMode={key === 'phone' ? 'numeric' : undefined}
              aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `profile-${key}-error` : undefined}
              placeholder={key === 'phone' ? '9XXXXXXXXX' : 'Not set'}
              onChange={event => {
                const value = event.target.value;
                if (key === 'phone' && !isPhMobileInput(value)) {
                  setFieldErrors(current => ({ ...current, phone: PH_MOBILE_ERROR }));
                  return;
                }
                if (key !== 'phone' && value.length > PROFILE_FIELD_LIMITS[key]) {
                  setFieldErrors(current => ({ ...current, [key]: PROFILE_FIELD_LIMIT_ERRORS[key] }));
                  return;
                }
                setDraft(current => ({ ...current, [key]: value }));
                const result = (key === 'phone' ? ProfilePhoneInputSchema : SelfProfileFieldSchemas[key]).safeParse(value);
                setFieldErrors(current => ({ ...current, [key]: result.success ? '' : result.error.issues[0].message }));
              }}
              className={`w-full min-w-0 ${key === 'phone' ? 'flex-1 bg-transparent rounded-r-lg' : 'bg-muted border rounded-lg'} ${fieldErrors[key] ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'} px-3 py-2 text-sm disabled:cursor-default`} />
          </div>
          {fieldErrors[key] && <p id={`profile-${key}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors[key]}</p>}
        </div>)}
        <div><span className="block text-xs font-semibold text-slate-500 mb-1">Groups</span><p aria-label="Groups" className="text-sm">{user?.groups?.map(group => group.name).join(', ') || 'No groups assigned'}</p><p className="mt-1 text-xs text-slate-500">Managed in Team Management → Groups.</p></div>
        <div><label htmlFor="profile-email" className="block text-xs font-semibold text-slate-500 mb-1">Email Address</label>
          <input id="profile-email" value={user?.email ?? ''} disabled className="w-full bg-muted border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      {editing && <div className="flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={() => { setDraft(saved()); setFieldErrors({}); setEditing(false); }} className="border rounded-lg px-4 py-2 text-sm">Cancel</button>
        <button type="submit" disabled={saving} className="bg-primary text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>}
    </form>
    {file && <AvatarCropDialog file={file} onClose={() => setFile(null)} onApply={async blob => {
      if (!user) throw new Error('Authentication required');
      const expectedUserId = user.id;
      const response = await authApi.uploadAvatar(blob);
      applyAuthUser(response.data.user, expectedUserId);
      toast.success('Profile picture updated.');
    }} />}
  </div>;
}
