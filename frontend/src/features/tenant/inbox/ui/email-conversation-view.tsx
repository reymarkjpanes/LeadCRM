'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowLeft, Forward, Loader2, Reply, ReplyAll, Trash2 } from 'lucide-react';
import { fetchGmailThread, fetchGmailCorrespondent, associateThreadDeal, setGmailThreadReadState, setGmailMessageReadState, archiveGmailThread, trashGmailThread, archiveGmailConversations, trashGmailConversations, type GmailEmail } from '../services/gmail.service';
import type { MailboxConversationDetail } from '@leadcrm/shared';
import { forwardDraft, replyDraft, replyAllDraft, type MailboxComposeDraft } from '../services/email-presentation';
import type { ApiRequestError } from '@/lib/api/client';
import EmailDetailView, { mailboxIconButton } from './email-detail-view';
import ComposeModal from './compose-modal';

const control = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50';
function TopicDealSelector({ topic, disabled, onAssociate }: { topic: MailboxConversationDetail['threads'][number]; disabled: boolean; onAssociate: (threadId: string, dealId: string) => void }) {
  const [dealId, setDealId] = useState('');
  if (!topic.canAssociateDeal || !topic.dealOptions.length) return null;
  return <form className="mt-2 flex min-w-0 flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (dealId) onAssociate(topic.threadId, dealId); }}>
    <select aria-label="Associate conversation with Deal" required disabled={disabled} value={dealId} onChange={event => setDealId(event.target.value)} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs sm:w-80"><option value="">Select the relevant open Deal</option>{topic.dealOptions.map(deal => <option key={deal.id} value={deal.id}>{deal.title} · {deal.stage}</option>)}</select>
    <button type="submit" disabled={!dealId || disabled} className={control}>Associate Deal</button>
  </form>;
}
export default function EmailConversationView({ email, mailboxEmail, revision = 0, retryAt = 0, onBack, onEmailsChanged }: {
  email: GmailEmail; mailboxEmail?: string; revision?: number; retryAt?: number; onBack: (error?: string) => void; onEmailsChanged: () => void;
}) {
  const [messages, setMessages] = useState<GmailEmail[]>([email]);
  const [topics, setTopics] = useState<MailboxConversationDetail['threads']>([]);
  const [nextPageToken, setNextPageToken] = useState<string>(), [messageCount, setMessageCount] = useState(email.messageCount ?? 1);
  const historyPending = useRef(false);
  const historyGeneration = useRef(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<{ id: string; title: string; stage: string }[]>([]);
  const [canAssociate, setCanAssociate] = useState(false), [dealId, setDealId] = useState('');
  const [busy, setBusy] = useState(false), [draft, setDraft] = useState<MailboxComposeDraft | null>(null);
  const [refresh, setRefresh] = useState(0), [cooldown, setCooldown] = useState(0);
  const pending = useRef(false), readPending = useRef(false), readAttempt = useRef('');
  const callbacks = useRef({ onBack, onEmailsChanged }); callbacks.current = { onBack, onEmailsChanged };
  const paused = Math.max(retryAt, cooldown) > Date.now();
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(0), Math.max(0, cooldown - Date.now())); return () => clearTimeout(timer); }, [cooldown]);
  const failure = useCallback((error: unknown) => {
    const request = error as ApiRequestError;
    setError(error instanceof Error ? error.message : 'This email action could not be completed. Try again.');
    setCooldown(Date.parse(request.retryAt ?? '') || 0);
    if ([401, 403, 404, 409].includes(request.status ?? 0)) { historyGeneration.current++; setMessages([]); setTopics([]); setNextPageToken(undefined); setDraft(null); callbacks.current.onBack('This conversation is no longer available. Refresh your Inbox or check your mailbox access.'); }
  }, []);
  useEffect(() => {
    let active = true;
    const generation = ++historyGeneration.current;
    const request = email.conversationId ? fetchGmailCorrespondent(email.conversationId) : fetchGmailThread(email.threadId);
    request.then(result => {
      if (!active || generation !== historyGeneration.current) return;
      const ordered: GmailEmail[] = email.conversationId ? result.emails : [...result.emails].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
      setMessages(ordered); setError(''); setNextPageToken(result.nextPageToken);
      if ('threads' in result) { setTopics(result.threads); setMessageCount(result.messageCount); }
      else { setDeals(result.dealOptions); setCanAssociate(result.canAssociateDeal); setMessageCount(ordered.length); }
      const latestId = ordered.reduce<GmailEmail | undefined>((latest, message) => !latest || Date.parse(message.date) >= Date.parse(latest.date) ? message : latest, undefined)?.id;
      setExpanded(previous => Object.fromEntries(ordered.map((message, index) => [message.id, previous[message.id] ?? (email.conversationId ? message.id === latestId : !message.isRead || index === ordered.length - 1)])));
    }).catch(error => { if (active) failure(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (historyGeneration.current === generation) historyGeneration.current++; };
  }, [email.conversationId, email.threadId, revision, refresh, failure]);
  const unreadIds = messages.filter(message => !message.isRead && (!email.conversationId || expanded[message.id])).map(message => message.id).sort().join(',');
  useEffect(() => {
    const key = `${email.threadId}:${unreadIds}`;
    if (loading || paused || !unreadIds || readPending.current || readAttempt.current === key) return;
    readAttempt.current = key; readPending.current = true;
    const action = email.conversationId ? (async () => { for (const id of unreadIds.split(',')) await setGmailMessageReadState(id, true); })() : setGmailThreadReadState(email.threadId, true);
    void action.then(() => {
      setMessages(previous => previous.map(message => unreadIds.split(',').includes(message.id) ? { ...message, isRead: true, labels: message.labels.filter(label => label !== 'UNREAD') } : message));
      callbacks.current.onEmailsChanged();
    }).catch(failure).finally(() => { readPending.current = false; });
  }, [email.conversationId, email.threadId, unreadIds, loading, paused, failure]);
  const loadMore = async () => {
    if (!email.conversationId || !nextPageToken || historyPending.current || loading) return;
    historyPending.current = true; setLoading(true);
    const generation = historyGeneration.current;
    try {
      const result = await fetchGmailCorrespondent(email.conversationId, nextPageToken);
      if (generation !== historyGeneration.current) return;
      setMessages(previous => [...new Map([...previous, ...result.emails].map(message => [message.id, message])).values()]);
      setTopics(previous => [...new Map([...previous, ...result.threads].map(topic => [topic.threadId, topic])).values()]);
      setNextPageToken(result.nextPageToken); setMessageCount(result.messageCount);
      setExpanded(previous => ({ ...previous, ...Object.fromEntries(result.emails.map(message => [message.id, false])) }));
    } catch (error) {
      if (generation !== historyGeneration.current) return;
      if ((error as ApiRequestError).code === 'MAILBOX_PAGE_CHANGED') { setMessages([]); setTopics([]); setRefresh(value => value + 1); }
      else failure(error);
    } finally { historyPending.current = false; if (generation === historyGeneration.current) setLoading(false); }
  };
  const mutate = async (action: () => Promise<unknown>, goBack = false) => {
    if (pending.current || paused) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); callbacks.current.onEmailsChanged(); if (goBack) callbacks.current.onBack(); else setRefresh(value => value + 1); }
    catch (error) { failure(error); }
    finally { pending.current = false; setBusy(false); }
  };
  const latest = messages.reduce<GmailEmail | undefined>((latest, message) => !latest || Date.parse(message.date) >= Date.parse(latest.date) ? message : latest, undefined);
  const context = [...messages].reverse().find(message => message.leadId || message.contactId) ?? latest;
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div role="toolbar" aria-label="Conversation actions" className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 sm:px-4">
      <button type="button" title="Back to inbox" aria-label="Back to inbox" className={mailboxIconButton} onClick={() => onBack()}><ArrowLeft size={18} /></button>
      <span className="flex-1" />
      {busy && <Loader2 aria-label="Updating conversation" className="h-4 w-4 animate-spin text-muted-foreground" />}
      <button type="button" title={email.conversationId ? 'Archive all authorized messages in this history' : 'Archive conversation'} aria-label="Archive conversation" disabled={loading || busy || paused || !latest} className={mailboxIconButton} onClick={() => void mutate(() => email.conversationId ? archiveGmailConversations([email.conversationId]) : archiveGmailThread(email.threadId), true)}><Archive size={18} /></button>
      <button type="button" title={email.conversationId ? 'Move all authorized messages in this history to trash' : 'Move conversation to trash'} aria-label="Move conversation to trash" disabled={loading || busy || paused || !latest} className={mailboxIconButton} onClick={() => void mutate(() => email.conversationId ? trashGmailConversations([email.conversationId]) : trashGmailThread(email.threadId), true)}><Trash2 size={18} /></button>
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <header className="space-y-3 border-b border-border px-3 py-5 sm:px-6">
        <h1 className="text-lg font-semibold leading-relaxed [overflow-wrap:anywhere] sm:text-xl">{email.conversationId ? email.participants?.filter(name => name !== 'You').join(', ') || email.correspondentAddresses?.join(', ') || 'Correspondent history' : messages[0]?.subject || '(no subject)'}{messageCount > 1 && <span aria-label={`${messageCount} messages`} className="ml-2 inline-block rounded bg-muted px-1.5 align-middle text-xs font-normal text-muted-foreground">{messageCount}</span>}</h1>
        {email.conversationId && <p className="text-xs text-muted-foreground">{email.correspondentAddresses?.join(', ')} · Toolbar actions apply to all accessible messages.</p>}
        {!email.conversationId && context && <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {context.leadId && <Link className="text-[var(--primary)] underline" href={`/crm/leads/${context.leadId}`}>View linked Lead</Link>}
            {context.contactId && <Link className="text-[var(--primary)] underline" href={`/crm/contacts/${context.contactId}`}>View linked Contact</Link>}
            {context.dealId && <Link className="text-[var(--primary)] underline" href={`/crm/deals/${context.dealId}`}>View related Deal</Link>}
            {!context.leadId && !context.contactId && <span className="text-muted-foreground">No unique CRM email match.</span>}
          </div>
          {context.needsDealAssociation && <p className="text-muted-foreground">Select the relevant open Deal for this conversation. Association does not change its stage.</p>}
          {canAssociate && deals.length > 0 && !context.dealId && <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (dealId) void mutate(() => associateThreadDeal(email.threadId, dealId)); }}>
            <select aria-label="Associate conversation with Deal" required disabled={busy} value={dealId} onChange={event => setDealId(event.target.value)} className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-2 sm:w-80"><option value="">Select the relevant open Deal</option>{deals.map(deal => <option key={deal.id} value={deal.id}>{deal.title} · {deal.stage}</option>)}</select>
            <button type="submit" disabled={!dealId || busy || paused} className={control}>Associate Deal</button>
          </form>}
          {(context.leadId || context.contactId) && !context.dealId && !deals.length && !loading && <p className="text-muted-foreground">No open Deal available.</p>}
        </div>}
        {loading && <p role="status" className="text-xs text-muted-foreground">Loading conversation…</p>}
        {paused && <p role="status" className="text-xs text-muted-foreground">Gmail updates are temporarily paused. Saved emails remain available.</p>}
        {error && <div role="alert" className="space-y-2 text-sm text-red-600"><p>{error}</p><button type="button" className={control} disabled={paused || busy} onClick={() => { readAttempt.current = ''; setLoading(true); setRefresh(value => value + 1); }}>Retry</button></div>}
      </header>
      {messages.map((message, index) => <React.Fragment key={message.id}>
        {email.conversationId && (index === 0 || message.threadId !== messages[index - 1].threadId) && <section className="border-b border-border bg-muted/30 px-3 py-3 sm:px-6" aria-label={`Original Gmail conversation: ${message.subject}`}>
          <div className="flex min-w-0 items-start gap-1">
            <h2 className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">{message.subject || '(no subject)'}</h2>
            <button type="button" title="Archive this topic" aria-label={`Archive topic: ${message.subject}`} className={mailboxIconButton} disabled={loading || busy || paused} onClick={() => void mutate(() => archiveGmailThread(message.threadId), true)}><Archive size={16} /></button>
            <button type="button" title="Trash this topic" aria-label={`Trash topic: ${message.subject}`} className={mailboxIconButton} disabled={loading || busy || paused} onClick={() => void mutate(() => trashGmailThread(message.threadId), true)}><Trash2 size={16} /></button>
          </div>
          {messages.some(item => item.threadId === message.threadId && expanded[item.id] && !item.dealId) && topics.filter(topic => topic.threadId === message.threadId).map(topic => <TopicDealSelector key={topic.threadId} topic={topic} disabled={loading || busy || paused} onAssociate={(threadId, dealId) => void mutate(() => associateThreadDeal(threadId, dealId))} />)}
        </section>}
        <EmailDetailView email={message} showContext={!!email.conversationId} expanded={expanded[message.id] ?? (!email.conversationId && index === messages.length - 1)} onToggle={() => setExpanded(previous => ({ ...previous, [message.id]: !(previous[message.id] ?? (!email.conversationId && index === messages.length - 1)) }))} onReply={() => setDraft(replyDraft(message))} onReplyAll={mailboxEmail ? () => setDraft(replyAllDraft(message, mailboxEmail)) : undefined} onForward={() => setDraft(forwardDraft(message))} disabled={loading || busy || paused} />
      </React.Fragment>)}
      {nextPageToken && <div className="px-3 py-3 sm:px-6"><button type="button" className={control} disabled={loading || busy || paused} onClick={() => void loadMore()}>Load more messages</button></div>}
      {latest && <div className="flex flex-wrap gap-2 px-3 py-5 sm:px-6 sm:pl-[76px]">
        <button type="button" className={control} disabled={loading || busy || paused} onClick={() => setDraft(replyDraft(latest))}><Reply size={16} />Reply</button>
        {mailboxEmail && <button type="button" className={control} disabled={loading || busy || paused} onClick={() => setDraft(replyAllDraft(latest, mailboxEmail))}><ReplyAll size={16} />Reply All</button>}
        <button type="button" className={control} disabled={loading || busy || paused} onClick={() => setDraft(forwardDraft(latest))}><Forward size={16} />Forward</button>
      </div>}
    </div>
    <ComposeModal isOpen={!!draft} initialDraft={draft} retryAt={Math.max(retryAt, cooldown)} onClose={() => setDraft(null)} onSent={() => { onEmailsChanged(); setRefresh(value => value + 1); }} />
  </div>;
}
