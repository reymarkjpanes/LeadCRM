'use client';
import type { FormSettings } from '../types/form.types';
import { FORM_TRACKING_KEYS, FormSettingsSchema } from '@leadcrm/shared';
export function FormSettingsPanel({ settings, onChange }: { settings: FormSettings; onChange: (s: FormSettings) => void }) {
  const email = FormSettingsSchema.safeParse(settings);
  const error = email.success ? '' : email.error.issues.find(i => i.path[0] === 'notificationEmail')?.message;
  return <div className="max-w-xl space-y-5 min-w-0">
    <section className="bg-white dark:bg-slate-900 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-2">
      <label htmlFor="notification-email" className="block text-sm font-semibold">Email notification for form submissions</label>
      <p className="text-xs text-slate-500">Optional</p>
      <input id="notification-email" type="email" value={settings.notificationEmail} maxLength={254} onChange={e => onChange({ ...settings, notificationEmail: e.target.value })} placeholder="e.g. alerts@yourcompany.com" aria-invalid={!!error} aria-describedby={error ? 'notification-email-error' : undefined} className="w-full min-w-0 border rounded-md p-2 text-sm" />
      {error && <p id="notification-email-error" className="text-sm text-red-600">{error}</p>}
    </section>
    <section className="bg-white dark:bg-slate-900 border border-slate-200 rounded-xl p-4 sm:p-5">
      <label className="flex gap-3 items-start text-sm font-semibold"><input type="checkbox" checked={settings.trackUrlParams} onChange={e => onChange({ ...settings, trackUrlParams: e.target.checked })} className="mt-1" />Track URL Parameters</label>
      <p className="text-xs text-slate-500 mt-2">Automatically save URL parameters such as utm_campaign and utm_medium.</p>
      {settings.trackUrlParams && <p className="text-xs text-slate-500 mt-3 break-words">Supported: {FORM_TRACKING_KEYS.join(', ')}. Up to 200 characters per value.</p>}
    </section>
  </div>;
}
