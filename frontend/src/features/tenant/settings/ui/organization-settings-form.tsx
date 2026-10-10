'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Globe, Mail, Phone, Link, MapPin, Pencil, Save, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { UpdateOrganizationSettingsSchema, formatOrganizationPhone, ORGANIZATION_FIELD_LIMIT_ERRORS, ORGANIZATION_FIELD_LIMITS, ORGANIZATION_PHONE_ERROR, COMPANY_INDUSTRIES, type OrganizationSettings } from '@leadcrm/shared';
import { PageHeader } from '@/shared/components/ui/page-header';
import { Card } from '@/shared/components/ui/card';
import { Badge, type BadgeProps } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
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
const accountStatuses: Record<OrganizationSettings['status'], { label: string; variant: BadgeProps['variant'] }> = {
  SANDBOX: { label: 'Sandbox', variant: 'info' },
  ACTIVE: { label: 'Active', variant: 'success' },
  SUSPENDED: { label: 'Suspended', variant: 'warning' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary' },
  DELETED: { label: 'Deleted', variant: 'destructive' },
};

export function OrganizationSettingsForm() {
  const { tenant, userCan, applyOrganizationSettings } = useAuth();
  const canView = userCan('settings', 'canView');
  const canEdit = userCan('settings', 'canEdit');
  const [organization, setOrganization] = useState<OrganizationSettings | null>(null);
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
    const controller = new AbortController();
    setFieldErrors({}); setOrganization(null); setSaved(null); setDraft(null); setEditing(false); setError(null); setSaving(false); busy.current = false;
    if (tenant?.id && canView) {
      settingsApiService.getOrganization(controller.signal).then(({ data }) => {
        if (generation.current !== current) return;
        if (!data || data.id !== tenant.id) throw new Error('Unable to load organization information for this workspace.');
        setOrganization(data);
        setSaved(toDraft(data)); setDraft(toDraft(data));
        applyOrganizationSettings(data);
      }).catch(reason => {
        if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Unable to load organization settings.');
      });
    }
    return () => { generation.current++; controller.abort(); };
  }, [tenant?.id, canView, reload, applyOrganizationSettings]);

  useEffect(() => {
    // Re-read authoritative profile/status on return without interrupting unsaved edits.
    const refresh = () => { if (canView && !editing && !busy.current) setReload(value => value + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [canView, editing]);

  useEffect(() => { if (!canEdit) { setEditing(false); setDraft(saved); } }, [canEdit, saved]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !canView || !canEdit || busy.current || !draft) return;
    if (Object.values(fieldErrors).some(Boolean)) return;
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
      if (!data || data.id !== tenant?.id) throw new Error('Unable to confirm the saved organization information.');
      const persisted = toDraft(data);
      setOrganization(data);
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

  const copyAccountId = async () => {
    if (!organization || organization.id !== tenant?.id || !canView) return;
    try {
      await navigator.clipboard.writeText(organization.id);
      toast.success('Account ID copied');
    } catch {
      toast.error('Unable to copy Account ID. Please copy it manually.');
    }
  };

  if (!canView) return <p role="alert">You do not have permission to access this settings section.</p>;
  if (error) return <div role="alert" className="space-y-3 text-sm"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)} className="border rounded-lg px-3 py-2">Retry</button></div>;
  if (!draft || organization?.id !== tenant?.id) return <div role="status" aria-label="Loading organization settings" className="w-full max-w-none min-w-0 space-y-6">
    <PageHeader title="General" subtitle="Manage your organization's profile and contact details." />
    <section className="bg-card border border-border rounded-2xl p-5 space-y-5">
    <div><h3 className="text-sm font-semibold">Organization Details</h3><p className="text-xs text-slate-500 mt-1">Your organization's profile and contact details</p></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-hidden="true">{fields.map(([key]) => <div key={key} className={`space-y-1.5 ${key === 'address' ? 'lg:col-span-2' : ''}`}>
      <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
      <div className={`${key === 'address' ? 'h-16' : 'h-10'} rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none`} />
    </div>)}</div>
    </section>
  </div>;

  const accountStatus = organization && accountStatuses[organization.status];
  return <form onSubmit={save} noValidate className="w-full max-w-none min-w-0 space-y-6">
    <PageHeader title="General" subtitle="Manage your organization's profile and contact details." />
    <section aria-labelledby="organization-details-title" className="bg-card border border-border rounded-2xl p-5 space-y-5">
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
          required: key === 'name' || key === 'email',
          'aria-invalid': !!fieldErrors[key],
          'aria-describedby': fieldErrors[key] ? `org-${key}-error` : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
            let next = event.target.value;
            if (key === 'phone') {
              next = next.replace(/^\+63\s*/, '');
              if (!/^[0-9 ()-]*$/.test(next) || next.replace(/\D/g, '').length > (next.startsWith('0') ? 10 : 9)) { setFieldErrors(errors => ({ ...errors, phone: ORGANIZATION_PHONE_ERROR })); return; }
            }
            if (next.length > ORGANIZATION_FIELD_LIMITS[key]) {
              setFieldErrors(errors => ({ ...errors, [key]: ORGANIZATION_FIELD_LIMIT_ERRORS[key] }));
              return;
            }
            const result = UpdateOrganizationSettingsSchema.safeParse({ [key]: next });
            const issue = result.success ? undefined : result.error.issues.find(item => item.path[0] === key);
            setFieldErrors(errors => ({ ...errors, [key]: issue?.message ?? '' }));
            setDraft(value => value && ({ ...value, [key]: next }));
          },
          className: `w-full min-w-0 pl-9 pr-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground outline-none transition-colors ${editing && !saving ? 'focus:border-primary' : 'cursor-default'}`,
        };
        return <div key={key} className={`min-w-0 space-y-1.5 ${key === 'address' ? 'lg:col-span-2' : ''}`}>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400" htmlFor={props.id}>{label}{props.required && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}</label>
          {key === 'phone' ? <div className="flex min-w-0 rounded-lg border border-border bg-muted focus-within:border-primary">
            <span className="flex shrink-0 items-center border-r border-border px-3 text-sm text-slate-500">+63</span>
            <input {...props} type="tel" inputMode="tel" placeholder="(28) 123-3488"
              className="w-full min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground rounded-r-lg outline-none"
              onBlur={() => setDraft(value => value && ({ ...value, phone: formatOrganizationPhone(value.phone) }))}
            />
          </div> : <div className="relative"><Icon aria-hidden="true" className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-500" />
            {key === 'industry' ? <select {...props} disabled={!editing || saving}>
              <option value="">Select industry</option>
              {draft.industry && !COMPANY_INDUSTRIES.includes(draft.industry as typeof COMPANY_INDUSTRIES[number]) && <option value={draft.industry} disabled>{draft.industry} (choose an industry)</option>}
              {COMPANY_INDUSTRIES.map(industry => <option key={industry} value={industry}>{industry}</option>)}
            </select> : key === 'address' ? <textarea {...props} rows={2} /> : <input {...props} type={key === 'email' ? 'email' : 'text'} />}
          </div>}
          {fieldErrors[key] && <p id={`org-${key}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">{fieldErrors[key]}</p>}
        </div>;
      })}
    </div>
    {editing && <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={saving} onClick={() => { setDraft(saved); setFieldErrors({}); setEditing(false); }} className="border rounded-lg px-4 py-2 text-sm">Cancel</button>
      <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"><Save size={14} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>}
    </section>
    <Card role="region" aria-labelledby="system-information-title" className="bg-card border-border shadow-none backdrop-blur-none p-5 space-y-5">
      <h3 id="system-information-title" className="text-sm font-semibold">System Information</h3>
      <dl className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="min-w-0 space-y-1.5">
          <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">Account ID</dt>
          <dd className="flex items-center gap-2 min-w-0">
            <span className="min-w-0 break-all font-mono text-sm text-foreground">{organization?.id}</span>
            <Button type="button" variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label="Copy Account ID" title="Copy Account ID" onClick={copyAccountId}><Copy aria-hidden="true" /></Button>
          </dd>
        </div>
        <div className="space-y-1.5">
          <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">Account Status</dt>
          <dd>{accountStatus ? <Badge variant={accountStatus.variant} className="rounded-full"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{accountStatus.label}</Badge> : <span className="text-sm text-slate-500">Unavailable</span>}</dd>
        </div>
      </dl>
    </Card>
  </form>;
}
