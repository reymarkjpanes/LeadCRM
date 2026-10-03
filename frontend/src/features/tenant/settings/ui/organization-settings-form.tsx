'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Globe, Mail, Phone, Link, MapPin, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { UpdateOrganizationSettingsSchema, formatOrganizationPhone, ORGANIZATION_PHONE_ERROR, type OrganizationSettings } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { settingsApiService } from '../services/settings.service';

const fields = [
  ['name', 'Organization Name', Building2], ['industry', 'Industry', Globe],
  ['email', 'Email', Mail], ['phone', 'Phone', Phone], ['domain', 'Domain', Link],
  ['address', 'Office Address', MapPin],
] as const;
type Draft = Record<typeof fields[number][0], string>;
const toDraft = (settings: OrganizationSettings): Draft => ({
  name: settings.name, industry: settings.industry ?? '', email: settings.email ?? '',
  phone: formatOrganizationPhone(settings.phone ?? ''), domain: settings.domain ?? '', address: settings.address ?? '',
});

export function OrganizationSettingsForm() {
  const { tenant, userCan, applyOrganizationSettings } = useAuth();
  const canEdit = userCan('settings', 'canEdit');
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setFieldErrors({}); setSaved(null); setDraft(null); setEditing(false); setError(null); setSaving(false); busy.current = false;
    if (tenant?.id) {
      settingsApiService.getOrganization().then(({ data }) => {
        if (generation.current !== current) return;
        setSaved(toDraft(data)); setDraft(toDraft(data));
      }).catch(reason => {
        if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Unable to load organization settings.');
      });
    }
    return () => { generation.current++; };
  }, [tenant?.id, reload]);

  useEffect(() => { if (!canEdit) { setEditing(false); setDraft(saved); } }, [canEdit, saved]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !canEdit || busy.current || !draft) return;
    const parsed = UpdateOrganizationSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      return;
    }
    setFieldErrors({});
    const current = generation.current;
    busy.current = true; setSaving(true);
    try {
      const { data } = await settingsApiService.updateOrganization(parsed.data);
      if (generation.current !== current) return;
      const persisted = toDraft(data);
      setSaved(persisted); setDraft(persisted); setEditing(false);
      applyOrganizationSettings(data);
      toast.success('Organization settings saved successfully');
    } catch (reason) {
      if (generation.current === current) {
        const errors = (reason as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
        if (errors) setFieldErrors(Object.fromEntries(Object.entries(errors).map(([key, messages]) => [key, messages[0]])));
        toast.error(reason instanceof Error ? reason.message : 'Unable to save organization settings.');
      }
    } finally {
      if (generation.current === current) { busy.current = false; setSaving(false); }
    }
  };

  if (error) return <div role="alert" className="space-y-3 text-sm"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)} className="border rounded-lg px-3 py-2">Retry</button></div>;
  if (!draft) return <div role="status" aria-label="Loading organization settings" className="w-full max-w-none min-w-0 space-y-6">
    <h2 className="text-xl font-bold text-slate-900 dark:text-white">General</h2>
    <section className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-5">
    <div><h3 className="text-sm font-semibold">Organization Details</h3><p className="text-xs text-slate-500 mt-1">Your organization's profile and contact details</p></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-hidden="true">{fields.map(([key]) => <div key={key} className={`space-y-1.5 ${key === 'address' ? 'lg:col-span-2' : ''}`}>
      <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
      <div className={`${key === 'address' ? 'h-16' : 'h-10'} rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none`} />
    </div>)}</div>
    </section>
  </div>;

  return <form onSubmit={save} noValidate className="w-full max-w-none min-w-0 space-y-6">
    <h2 className="text-xl font-bold text-slate-900 dark:text-white">General</h2>
    <section aria-labelledby="organization-details-title" className="bg-white dark:bg-[#25313D] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-5 space-y-5">
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 id="organization-details-title" className="text-sm font-semibold">Organization Details</h3>
        {canEdit && !editing && <button type="button" onClick={() => { setDraft(saved); setFieldErrors({}); setEditing(true); }} className="shrink-0 flex items-center gap-1 border rounded-lg px-3 py-2 text-sm"><Pencil size={13} />Edit</button>}
      </div>
      <p className="text-xs text-slate-500 mt-1">Your organization's profile and contact details</p>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {fields.map(([key, label, Icon]) => {
        const props = {
          id: `org-${key}`, value: draft[key], readOnly: !editing || saving,
          'aria-invalid': !!fieldErrors[key],
          'aria-describedby': fieldErrors[key] ? `org-${key}-error` : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            let next = event.target.value;
            if (key === 'phone') {
              next = next.replace(/^\+63\s*/, '');
              if (!/^[0-9 ()-]*$/.test(next)) { setFieldErrors(errors => ({ ...errors, phone: ORGANIZATION_PHONE_ERROR })); return; }
            }
            setFieldErrors(errors => ({ ...errors, [key]: '' }));
            setDraft(value => value && ({ ...value, [key]: next }));
          },
          className: `w-full min-w-0 pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#1B252F] border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none transition-colors ${editing && !saving ? 'focus:border-blue-500' : 'cursor-default'}`,
        };
        return <div key={key} className={`min-w-0 space-y-1.5 ${key === 'address' ? 'lg:col-span-2' : ''}`}>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor={props.id}>{label}</label>
          {key === 'phone' ? <div className="flex min-w-0 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-[#1B252F] focus-within:border-blue-500">
            <span className="flex shrink-0 items-center border-r border-gray-200 dark:border-slate-700 px-3 text-sm text-slate-500">+63</span>
            <input {...props} type="tel" inputMode="tel" placeholder="(28) 123-3488"
              className="w-full min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-white rounded-r-lg outline-none"
              onBlur={() => setDraft(value => value && ({ ...value, phone: formatOrganizationPhone(value.phone) }))}
            />
          </div> : <div className="relative"><Icon aria-hidden="true" className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-500" />
            {key === 'address' ? <textarea {...props} rows={2} /> : <input {...props} type={key === 'email' ? 'email' : 'text'} />}
          </div>}
          {fieldErrors[key] && <p id={`org-${key}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors[key]}</p>}
        </div>;
      })}
    </div>
    {editing && <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={saving} onClick={() => { setDraft(saved); setFieldErrors({}); setEditing(false); }} className="border rounded-lg px-4 py-2 text-sm">Cancel</button>
      <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"><Save size={14} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>}
    </section>
  </form>;
}
