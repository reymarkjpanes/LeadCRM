'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mail, Check, Filter, ArrowDownAZ, Loader2, Pencil, Search } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { getGmailStatus, fetchGmailEmails, syncGmail, disconnectGmail, GmailConnectionStatus, GmailEmail } from '../services/gmail.service';
import InboxCurrentEmpty from './inbox-current-empty';
import InboxEmailList from './inbox-email-list';
import EmailConversationView from './email-conversation-view';
import ComposeModal from './compose-modal';
import type { ApiRequestError } from '@/lib/api/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { consumeRecordEmailCompose } from '../services/compose-navigation';
import type { MailboxListOptions } from '@leadcrm/shared';

const FILTERS = [{ id: 'all', label: 'All emails' }, { id: 'unread', label: 'Unread only' }, { id: 'sent', label: 'Sent' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'drafts', label: 'Drafts only' }] as const;
const SORTS = [{ id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }, { id: 'unread', label: 'Unread first' }] as const;
const control = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50';

export default function InboxPage(): React.ReactElement {
  const searchParams = useSearchParams(), router = useRouter();
  const [filter, setFilter] = useState<NonNullable<MailboxListOptions['filter']>>('all');
  const [sort, setSort] = useState<NonNullable<MailboxListOptions['sort']>>('newest');
  const [connectionStatus, setConnectionStatus] = useState<GmailConnectionStatus | null>(null);
  const [emails, setEmails] = useState<GmailEmail[]>([]), [unreadCount, setUnreadCount] = useState<number>();
  const [isLoadingStatus, setIsLoadingStatus] = useState(true), [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false), [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(''), [syncError, setSyncError] = useState('');
  const [menu, setMenu] = useState<'filter' | 'sort' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('');
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<{ to: string; subject: string; body: string; draftId?: string } | null>(null);
  useEffect(() => {
    const request = consumeRecordEmailCompose(new URL(window.location.href));
    if (!request) return;
    // Remove the request synchronously so refresh and Strict Mode cannot replay it.
    window.history.replaceState(window.history.state, '', request.url);
    // Keep Next's canonical URL in sync so a later render cannot restore the consumed query.
    router.replace(`${request.url.pathname}${request.url.search}${request.url.hash}`, { scroll: false });
    if (!request.to) { toast.error('Please enter a valid email address'); return; }
    setComposeDraft({ to: request.to, subject: request.subject, body: '' });
    setIsComposeOpen(true);
  }, [searchParams, router]);

  const [selectedEmail, setSelectedEmail] = useState<GmailEmail | null>(null);
  const [revision, setRevision] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string>();
  const [page, setPage] = useState(1);
  const pageRef = useRef(1), tokenRef = useRef<string | undefined>(undefined);
  const loaded = useRef(false), syncPending = useRef(false);
  const request = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const requestId = useRef(0);
  const shouldReduceMotion = useReducedMotion();
  const [retryAt, setRetryAt] = useState(0);
  // A missing or unhealthy SSE endpoint must not reconnect forever.
  // Polling remains database-only; it never starts Gmail synchronization.
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [apiCooldownUntil, setApiCooldownUntil] = useState(0);
  const cooldownRef = useRef(0);

  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    setError(url.searchParams.get('gmail_error') ?? '');
    if (url.searchParams.has('gmail_error') || url.searchParams.has('gmail_connected')) {
      url.searchParams.delete('gmail_error'); url.searchParams.delete('gmail_connected'); window.history.replaceState(window.history.state, '', url);
    }
    getGmailStatus().then(status => { if (active) { setConnectionStatus(status); setSyncError(status.syncError ?? ''); setRetryAt(Date.parse(status.retryAt ?? '') || 0); } })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setIsLoadingStatus(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    if (menu) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  useEffect(() => { if (!retryAt) return; const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now())); return () => clearTimeout(timer); }, [retryAt]);

  const loadEmails = useCallback((pageToken?: string, targetPage = 1): Promise<void> => {
    if (Date.now() < cooldownRef.current) return Promise.resolve();
    const key = JSON.stringify([filter, sort, debouncedSearch, pageToken]);
    if (request.current?.key === key) return request.current.promise;
    request.current?.controller.abort();
    const controller = new AbortController(), id = ++requestId.current;
    setRefreshing(true); if (!loaded.current) setInitialLoading(true);
    const promise = (async () => {
      try {
        const result = await fetchGmailEmails({ filter, sort, query: debouncedSearch.trim(), maxResults: 30, pageToken }, controller.signal);
        if (controller.signal.aborted || id !== requestId.current) return;
        setEmails(result.emails); setUnreadCount(result.unreadCount); setNextPageToken(result.nextPageToken); setError('');
        if (result.unreadCount !== undefined) window.dispatchEvent(new CustomEvent('mailbox-unread-change', { detail: result.unreadCount }));
        loaded.current = true; pageRef.current = targetPage; tokenRef.current = pageToken; setPage(targetPage);
      } catch (error) {
        if (controller.signal.aborted || id !== requestId.current) return;
        const apiError = error as ApiRequestError;
        if (apiError.status === 429) {
          const until = Date.parse(apiError.retryAt ?? '');
          cooldownRef.current = Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60_000;
          setApiCooldownUntil(cooldownRef.current);
          setError('Too many requests. Inbox updates will resume automatically.');
        } else {
          setError(error instanceof Error ? error.message : 'Unable to load emails.');
        }
        if ([401, 403, 409].includes((error as ApiRequestError).status ?? 0)) { setEmails([]); setSelectedEmail(null); }
      } finally {
        if (id === requestId.current) { request.current = null; setRefreshing(false); setInitialLoading(false); }
      }
    })();
    request.current = { key, controller, promise };
    return promise;
  }, [filter, sort, debouncedSearch]);
  useEffect(() => {
    if (connectionStatus?.isConnected) void loadEmails();
    return () => { request.current?.controller.abort(); request.current = null; requestId.current++; };
  }, [connectionStatus?.isConnected, loadEmails]);

  useEffect(() => {
    if (!connectionStatus?.isConnected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const refresh = () => {
      if (!active || document.visibilityState === 'hidden' || Date.now() < cooldownRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active || Date.now() < cooldownRef.current) return;
        void loadEmails(tokenRef.current, pageRef.current);
        setRevision(value => value + 1);
        void getGmailStatus().then(status => {
          if (active) {
            setConnectionStatus(status);
            setSyncError(status.syncError ?? '');
            setRetryAt(Date.parse(status.retryAt ?? '') || 0);
          }
        }).catch(() => undefined);
      }, 250);
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', visible);
    // The connection may fail (404 during a partial deployment, or 429).
    // Do not let EventSource's automatic 3-second retry loop hammer the API.
    let events: EventSource | null = null;
    if (!streamUnavailable && typeof EventSource !== 'undefined') {
      events = new EventSource('/api/proxy/integrations/gmail/events');
      events.addEventListener('mailbox-change', refresh);
      events.addEventListener('mailbox-access-changed', () => { setEmails([]); setSelectedEmail(null); refresh(); });
      events.onerror = () => {
        events?.close();
        events = null;
        setStreamUnavailable(true);
      };
    }
    // Slow, visibility-aware fallback that also respects API Retry-After.
    const poll = streamUnavailable ? window.setInterval(refresh, 60_000) : undefined;
    return () => {
      active = false;
      events?.close();
      if (poll !== undefined) window.clearInterval(poll);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [connectionStatus?.isConnected, loadEmails, streamUnavailable]);

  useEffect(() => {
    if (!apiCooldownUntil) return;
    const delay = Math.max(0, apiCooldownUntil - Date.now());
    const timer = window.setTimeout(() => {
      if (Date.now() >= cooldownRef.current) {
        cooldownRef.current = 0;
        setApiCooldownUntil(0);
        if (connectionStatus?.isConnected) void loadEmails(tokenRef.current, pageRef.current);
      }
    }, delay + 25);
    return () => window.clearTimeout(timer);
  }, [apiCooldownUntil, connectionStatus?.isConnected, loadEmails]);

  const sync = async () => {
    if (syncPending.current || retryAt > Date.now() || Date.now() < cooldownRef.current) return;
    syncPending.current = true; setSyncing(true); setSyncError('');
    try {
      const result = await syncGmail();
      setSyncError(result.hasMore ? 'Email updates are continuing in the background.' : '');
      await loadEmails(tokenRef.current, pageRef.current);
    } catch (error) {
      setSyncError((error as ApiRequestError).code === 'GMAIL_RATE_LIMITED' ? 'Gmail updates are temporarily paused. Saved emails remain available.' : error instanceof Error ? error.message : 'Email updates are delayed.');
      setRetryAt(Date.parse((error as ApiRequestError).retryAt ?? '') || 0);
    } finally { syncPending.current = false; setSyncing(false); }
  };
  const openEmail = (email: GmailEmail) => {
    if (email.scheduledStatus) return;
    if (filter === 'drafts') { setComposeDraft({ to: email.to.join(', '), subject: email.subject, body: email.body, draftId: email.draftId }); setIsComposeOpen(true); }
    else setSelectedEmail(email);
  };
  const animation = shouldReduceMotion ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } };
  if (selectedEmail) return <motion.div {...animation} className="flex h-full min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card">
    <EmailConversationView key={selectedEmail.threadId} email={selectedEmail} revision={revision} retryAt={retryAt} onBack={message => { setSelectedEmail(null); if (message) setError(message); }} onEmailsChanged={() => { void loadEmails(tokenRef.current, pageRef.current); setRevision(value => value + 1); }} />
  </motion.div>;
  return <motion.div {...animation} className="flex h-full min-h-0 min-w-0 flex-col gap-4 pb-16">
    <header><h1 className="font-display text-2xl font-bold tracking-tight">Inbox</h1>{unreadCount !== undefined && connectionStatus?.isConnected && <p className="mt-1 text-xs text-muted-foreground">{unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}</p>}</header>
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
      {connectionStatus?.isConnected && <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3"><span className="shrink-0 rounded-full bg-[var(--color-brand-light)] p-2 text-[var(--primary)]"><Mail size={18} /></span><div className="min-w-0"><p className="text-sm font-semibold">Work email</p><p className="break-all text-xs text-muted-foreground">{connectionStatus.email}</p></div></div>
          <div className="flex items-center gap-2"><button className={control} disabled={syncing || retryAt > Date.now() || apiCooldownUntil > Date.now()} onClick={() => void sync()}>{syncing && <Loader2 size={14} className="animate-spin" />}Sync now</button><button className={control} onClick={() => void disconnectGmail().then(() => { setConnectionStatus(null); setEmails([]); setUnreadCount(undefined); }).catch(error => setError(error.message))}>Disconnect</button></div>
        </div>
        <div ref={menuRef} className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-5" onKeyDown={event => { if (event.key === 'Escape') setMenu(null); }}>
          <label className="flex min-h-10 min-w-0 basis-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 sm:flex-1 sm:basis-auto"><Search size={16} className="shrink-0 text-muted-foreground" /><input aria-label="Search email" placeholder="Search email..." value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" /></label>
          <div className="relative"><button className={control} aria-label="Filter emails" aria-expanded={menu === 'filter'} aria-haspopup="menu" onClick={() => setMenu(menu === 'filter' ? null : 'filter')}><Filter size={14} />Filter</button>{menu === 'filter' && <div role="menu" aria-label="Filter by" className="absolute left-0 top-full z-20 mt-2 w-48 rounded-xl border border-border bg-card py-2 shadow-lg"><p className="px-4 py-1 text-[10px] font-bold uppercase text-muted-foreground">Filter by</p>{FILTERS.map(option => <button key={option.id} role="menuitemradio" aria-checked={filter === option.id} className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted', filter === option.id && 'bg-[var(--color-brand-light)] text-[var(--primary)]')} onClick={() => { setFilter(option.id); setMenu(null); }}><Check size={14} className={filter === option.id ? '' : 'invisible'} />{option.label}</button>)}</div>}</div>
          <div className="relative"><button className={control} aria-label="Sort emails" aria-expanded={menu === 'sort'} aria-haspopup="menu" onClick={() => setMenu(menu === 'sort' ? null : 'sort')}><ArrowDownAZ size={14} />Sort</button>{menu === 'sort' && <div role="menu" aria-label="Sort by" className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-border bg-card py-2 shadow-lg">{SORTS.map(option => <button key={option.id} role="menuitemradio" aria-checked={sort === option.id} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted" onClick={() => { setSort(option.id); setMenu(null); }}><Check size={14} className={sort === option.id ? '' : 'invisible'} />{option.label}</button>)}</div>}</div>
        </div>
      </>}
      {syncError && <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{syncError}</p>}
      {error && <p role="alert" className="px-4 py-3 text-sm text-red-600">{error}</p>}
      {isLoadingStatus || connectionStatus?.isConnected && initialLoading ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading emails...</div> : !connectionStatus?.isConnected ? <InboxCurrentEmpty /> : <InboxEmailList emails={emails} onEmailClick={openEmail} refreshDisabled={refreshing} onEmailsChanged={() => loadEmails(tokenRef.current, pageRef.current)} totalCount={emails.length} currentPage={page} hasNextPage={!!nextPageToken} onNextPage={() => { if (nextPageToken) void loadEmails(nextPageToken, page + 1); }} onPrevPage={() => void loadEmails(page > 2 ? String((page - 2) * 30) : undefined, Math.max(1, page - 1))} />}
    </section>
    {connectionStatus?.isConnected && !isComposeOpen && <button aria-label="Compose new email" onClick={() => { setComposeDraft(null); setIsComposeOpen(true); }} className="fixed bottom-4 right-3 z-40 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-lg sm:bottom-6 sm:right-6 sm:px-6"><Pencil size={18} />Compose</button>}
    <ComposeModal isOpen={isComposeOpen} retryAt={retryAt} onClose={() => { setIsComposeOpen(false); setComposeDraft(null); }} onSent={() => void loadEmails()} initialDraft={composeDraft} />
  </motion.div>;
}
