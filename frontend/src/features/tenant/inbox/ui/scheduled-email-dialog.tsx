'use client';
import { useEffect, useRef, useState } from 'react';
import type { ScheduledMailboxEmailDetail } from '@leadcrm/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { getScheduledGmailEmail, cancelScheduledGmailEmail } from '../services/gmail.service';
import { safeMailboxHtml } from '../services/email-html';

export function ScheduledEmailDialog({ id, onClose, onCancelled }: { id: string; onClose: () => void; onCancelled: () => void }) {
  const [detail, setDetail] = useState<ScheduledMailboxEmailDetail>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    getScheduledGmailEmail(id).then(result => { if (active) setDetail(result); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Scheduled email could not be loaded.'); });
    return () => { active = false; };
  }, [id]);
  async function cancel() {
    if (pending.current || !detail?.canCancel) return;
    pending.current = true; setBusy(true); setError('');
    try { await cancelScheduledGmailEmail(id); onCancelled(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Scheduled email could not be cancelled.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent aria-label="Scheduled email" className="max-w-2xl">
    <DialogHeader><DialogTitle>Scheduled email</DialogTitle></DialogHeader>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!detail && !error && <p role="status">Loading scheduled email…</p>}
    {detail && <>
      <dl className="space-y-2 text-sm [overflow-wrap:anywhere]"><div><dt className="text-muted-foreground">To</dt><dd>{detail.recipients.join(', ')}</dd></div><div><dt className="text-muted-foreground">Subject</dt><dd>{detail.subject}</dd></div><div><dt className="text-muted-foreground">Scheduled for (Manila time)</dt><dd>{new Date(detail.scheduledAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</dd></div><div><dt className="text-muted-foreground">Status</dt><dd>{detail.status}</dd></div></dl>
      {detail.lastError && <p role="status" className="text-sm text-amber-700">{detail.lastError}</p>}
      <div aria-label="Scheduled message content" className="max-h-72 overflow-auto rounded-lg border border-border p-3 text-sm [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: safeMailboxHtml(detail.body) }} />
      {detail.canCancel ? <div className="flex flex-wrap items-center justify-end gap-2">
        {confirm ? <><p className="w-full text-sm">Cancel this scheduled delivery? The email will remain in Drafts for editing.</p><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Keep scheduled</Button><Button variant="destructive" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</Button></> : <Button variant="outline" onClick={() => setConfirm(true)}>Cancel scheduled send</Button>}
      </div> : <p className="text-sm text-muted-foreground">Delivery has started or needs verification. Check Gmail Sent before sending again.</p>}
    </>}
  </DialogContent></Dialog>;
}
