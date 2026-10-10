'use client';
import { useEffect, useState, useRef } from 'react';
import { FORM_TRACKING_KEYS, validateFormValues, type PublicFormDefinition } from '@leadcrm/shared';
import { FormInput } from './form-input';
export default function PublicFormPage({ publicId }: { publicId: string }) {
  const requestId = useRef<string | undefined>(undefined);
  const [form, setForm] = useState<PublicFormDefinition | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string | boolean | string[]>>({}), [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    fetch('/api/proxy/public/forms/' + encodeURIComponent(publicId), { signal: controller.signal, cache: 'no-store' }).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(r.status === 404 ? 'This form is unavailable.' : 'Unable to load this form. Please retry.'); setForm(body.data);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [publicId, retry]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!form || busy) return;
    const checked = validateFormValues(form.fields, values); setErrors(checked.errors); setError('');
    if (Object.keys(checked.errors).length) { document.getElementById('input-' + Object.keys(checked.errors)[0])?.focus(); return; }
    setBusy(true);
    requestId.current ??= crypto.randomUUID();
    try {
      const query = new URLSearchParams(window.location.search), tracking: Record<string, string> = {};
      if (form.trackUrlParams) for (const key of FORM_TRACKING_KEYS) { const v = query.get(key); if (v) tracking[key] = v.slice(0, 200); }
      const r = await fetch('/api/proxy/public/forms/' + encodeURIComponent(publicId) + '/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId.current, version: form.version, values, tracking, website }) });
      const body = await r.json();
      if (!r.ok) { if (body.fieldErrors) setErrors(body.fieldErrors); throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || 'Submission failed. Please try again.'); }
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit. Please retry.'); } finally { setBusy(false); }
  }
  return <main className="min-h-[var(--app-viewport-height)] bg-slate-100 px-3 py-6 sm:p-8 text-slate-900">
    <div className="w-full max-w-2xl mx-auto min-w-0">
      {loading ? <div aria-label="Loading form" className="animate-pulse h-96 rounded-xl bg-slate-200" /> : done ? <section role="status" className="bg-white rounded-xl p-6 text-center space-y-3"><h1 className="text-2xl font-bold">Thank you!</h1><p>Thank you for submitting the form.</p><p className="text-sm">Your submission has been received.<br />We will get back to you shortly.</p></section> : <>
        {error && <div role="alert" className="bg-white border border-red-200 rounded-lg p-4 mb-4 text-red-700 break-words">{error}{!form && <button onClick={() => setRetry(v => v + 1)} className="block underline mt-2">Retry</button>}</div>}
        {form && <form noValidate onSubmit={submit} className="rounded-lg border p-4 sm:p-8 space-y-6" style={{ backgroundColor: form.design.generalBg || '#fff', borderColor: form.design.generalBorder || '#e2e8f0', color: form.design.generalText || '#0f172a' }}>
          <h1 className="text-2xl font-bold break-words">{form.name}</h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{form.fields.map(f => <div key={f.id} className={f.width === 'half' ? 'min-w-0' : 'min-w-0 sm:col-span-2'}><FormInput field={f} value={values[f.id]} onChange={v => setValues(old => ({ ...old, [f.id]: v }))} error={errors[f.id]} design={form.design} /></div>)}</div>
          <div className="hidden" aria-hidden="true"><label>Leave empty<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div>
          <button type="submit" disabled={busy} className="w-full rounded-md border py-3 font-semibold disabled:opacity-50" style={{ backgroundColor: form.design.buttonBg || '#2563eb', borderColor: form.design.buttonBorder || '#2563eb', color: form.design.buttonText || '#fff' }}>{busy ? 'Submitting…' : 'Submit'}</button>
        </form>}
      </>}
    </div>
  </main>;
}
