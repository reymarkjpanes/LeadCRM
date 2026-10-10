'use client';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getFormProductValues, ProductInterestIdSchema, type FormSubmissionRecord } from '@leadcrm/shared';
import type { FormRecord } from '../types/form.types';
import { formsApi } from '@/shared/services/forms.api';
import { useAuth } from '@/store/AuthContext';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
export function FormSharePanel({ form, dirty, shareLink, embedCode }: { form: FormRecord; dirty: boolean; shareLink: string; embedCode: string }) {
  const { user } = useAuth();
  const canViewSubmissions = useHasPermission('forms.view_submissions');
  const [history, setHistory] = useState<FormSubmissionRecord[]>([]), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true), [more, setMore] = useState(false), [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Unable to copy'); } };
  const load = useCallback(async (next: number) => {
    if (!canViewSubmissions || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await formsApi.submissions(form.id, next, controller.signal);
      if (controller.signal.aborted) return;
      setHistory(old => next === 1 ? result.data : [...new Map([...old, ...result.data].map(row => [row.id, row])).values()]);
      setPage(next); setMore(result.meta.hasMore);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load submissions'); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }, [form.id, canViewSubmissions, user?.tenantId]);
  useEffect(() => {
    setHistory([]); setPage(0); setMore(false); setError('');
    void load(1);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [load]);
  return <div className="max-w-2xl space-y-5 min-w-0">
    {(dirty || form.publishedRevision !== form.revision) && <p className="border border-amber-200 bg-amber-50 text-amber-800 p-4 rounded-lg text-sm">This form has unpublished edits. Publish it in order to see the latest changes.</p>}
    {!form.publishedVersion ? <p className="text-sm text-slate-500">Publish this form to enable its public link and embed code.</p> : <>
      <section className="border rounded-lg p-4 bg-white dark:bg-slate-900 space-y-3 min-w-0"><h2 className="font-semibold">Embed Code</h2><pre className="max-w-full overflow-x-auto bg-slate-100 text-slate-800 p-3 text-xs rounded">{embedCode}</pre><button className="text-sm border rounded px-3 py-2" onClick={() => void copy(embedCode)}>Copy code</button></section>
      <section className="border rounded-lg p-4 bg-white dark:bg-slate-900 space-y-3 min-w-0"><h2 className="font-semibold">Share Link</h2><a className="text-sm text-blue-600 break-all" href={shareLink} target="_blank" rel="noreferrer">{shareLink}</a><button className="block text-sm border rounded px-3 py-2" onClick={() => void copy(shareLink)}>Copy share link</button></section>
    </>}
    {canViewSubmissions && <section aria-label="Submission History" className="border rounded-lg p-4 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2"><h2 className="min-w-0 font-semibold">Submission History</h2><RefreshButton label="Refresh submissions" refreshing={busy} onClick={() => load(1)} /></div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="relative min-w-0" aria-busy={busy}>
      {busy && <div className={history.length ? 'absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded bg-background/90' : ''}><DataLoadingSpinner label="Loading submissions" hideLabel /></div>}
      {!!page && !busy && !error && !history.length && <p className="text-sm text-slate-500">No submissions yet.</p>}
      <div className="space-y-3">{history.map(s => <details key={s.id} className="min-w-0 border rounded p-3 text-sm"><summary className="cursor-pointer [overflow-wrap:anywhere]">{formatDateTime(s.submittedAt)} · Version {s.publishedVersion} · {s.contactId ? 'Contact' : 'Lead'}</summary>
        <dl className="mt-3 space-y-2">{s.publishedConfig.fields.filter(f => f.id in s.values).map(f => <div key={f.id}><dt className="font-semibold [overflow-wrap:anywhere]">{f.label}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{f.mapToField === 'productInterest'
          ? getFormProductValues(s.values[f.id]).map(value => s.productLabels?.[value] ?? f.optionLabels?.[value] ?? (ProductInterestIdSchema.safeParse(value).success ? 'Unavailable product' : value)).join('\n') || '—'
          : String(s.values[f.id])}</dd></div>)}</dl>
        <p className="text-xs text-slate-500 mt-3">Notification: {s.notificationStatus}</p>
        {Object.entries(s.tracking).map(([key,value]) => <p key={key} className="text-xs [overflow-wrap:anywhere]">{key}: {value}</p>)}
      </details>)}</div>
      </div>
      {more && <button disabled={busy} onClick={() => void load(page + 1)} className="text-sm text-blue-600 underline">Load more</button>}
    </section>}
  </div>;
}
