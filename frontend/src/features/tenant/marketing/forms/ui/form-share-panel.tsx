'use client';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useState } from 'react';
import { toast } from 'sonner';
import type { FormSubmissionRecord } from '@leadcrm/shared';
import type { FormRecord } from '../types/form.types';
import { formsApi } from '@/shared/services/forms.api';
export function FormSharePanel({ form, dirty, shareLink, embedCode }: { form: FormRecord; dirty: boolean; shareLink: string; embedCode: string }) {
  const canViewSubmissions = useHasPermission('forms.view_submissions');
  const [history, setHistory] = useState<FormSubmissionRecord[]>([]), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false), [more, setMore] = useState(false), [error, setError] = useState('');
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Unable to copy'); } };
  async function load(next: number) {
    if (!canViewSubmissions) return;
    setBusy(true); setError('');
    try { const result = await formsApi.submissions(form.id, next); setHistory(old => next === 1 ? result.data : [...old, ...result.data]); setPage(next); setMore(result.meta.hasMore); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load submissions'); } finally { setBusy(false); }
  }
  return <div className="max-w-2xl space-y-5 min-w-0">
    {(dirty || form.publishedRevision !== form.revision) && <p className="border border-amber-200 bg-amber-50 text-amber-800 p-4 rounded-lg text-sm">This form has unpublished edits. Publish it in order to see the latest changes.</p>}
    {!form.publishedVersion ? <p className="text-sm text-slate-500">Publish this form to enable its public link and embed code.</p> : <>
      <section className="border rounded-lg p-4 bg-white dark:bg-slate-900 space-y-3 min-w-0"><h2 className="font-semibold">Embed Code</h2><pre className="max-w-full overflow-x-auto bg-slate-100 text-slate-800 p-3 text-xs rounded">{embedCode}</pre><button className="text-sm border rounded px-3 py-2" onClick={() => void copy(embedCode)}>Copy code</button></section>
      <section className="border rounded-lg p-4 bg-white dark:bg-slate-900 space-y-3 min-w-0"><h2 className="font-semibold">Share Link</h2><a className="text-sm text-blue-600 break-all" href={shareLink} target="_blank" rel="noreferrer">{shareLink}</a><button className="block text-sm border rounded px-3 py-2" onClick={() => void copy(shareLink)}>Copy share link</button></section>
    </>}
    {canViewSubmissions && <section className="border rounded-lg p-4 space-y-3 min-w-0"><h2 className="font-semibold">Submission history</h2><button disabled={busy} className="text-sm text-blue-600 underline" onClick={() => void load(1)}>{page ? 'Refresh submissions' : 'View submissions'}</button>
      {busy && <div aria-label="Loading submissions" className="animate-pulse h-20 bg-slate-100 rounded" />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!!page && !busy && !history.length && <p className="text-sm text-slate-500">No submissions yet.</p>}
      {history.map(s => <details key={s.id} className="border rounded p-3 text-sm"><summary className="cursor-pointer">{new Date(s.submittedAt).toLocaleString()} · Version {s.publishedVersion} · {s.contactId ? 'Contact' : 'Lead'}</summary>
        <dl className="mt-3 space-y-2">{s.publishedConfig.fields.filter(f => f.id in s.values).map(f => <div key={f.id}><dt className="font-semibold">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{String(s.values[f.id])}</dd></div>)}</dl>
        <p className="text-xs text-slate-500 mt-3">Notification: {s.notificationStatus}</p>
        {Object.entries(s.tracking).map(([key,value]) => <p key={key} className="text-xs break-words">{key}: {value}</p>)}
      </details>)}
      {more && <button disabled={busy} onClick={() => void load(page + 1)} className="text-sm text-blue-600 underline">Load more</button>}
    </section>}
  </div>;
}
