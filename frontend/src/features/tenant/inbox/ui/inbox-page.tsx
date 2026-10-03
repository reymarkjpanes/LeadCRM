'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Mail, ChevronDown, Check, Filter, ArrowDownAZ, Loader2, Pencil, Tag, Users, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { getGmailStatus, fetchGmailEmails, syncGmail, disconnectGmail, GmailConnectionStatus, GmailEmail } from '../services/gmail.service';
import InboxCurrentEmpty from './inbox-current-empty';
import InboxDoneEmpty from './inbox-done-empty';
import InboxFutureEmpty from './inbox-future-empty';
import InboxEmailList from './inbox-email-list';
import EmailConversationView from './email-conversation-view';
import ComposeModal from './compose-modal';
import type { ApiRequestError } from '@/lib/api/client';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { consumeLeadEmailCompose } from '../services/compose-navigation';

type InboxView = 'current' | 'done' | 'future' | 'drafts' | 'sent' | 'all';
type InboxCategory = 'primary' | 'promotions' | 'social' | 'updates';

const VIEW_OPTIONS: { id: InboxView; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'all', label: 'All conversations' },
  { id: 'sent', label: 'Sent' },
  { id: 'done', label: 'Done' },
  { id: 'future', label: 'Future' },
  { id: 'drafts', label: 'Drafts' },
];

export default function InboxPage(): React.ReactElement {
  const searchParams = useSearchParams();
  const [activeView, setActiveView] = useState<InboxView>('current');
  const [activeCategory, setActiveCategory] = useState<InboxCategory>('primary');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<GmailConnectionStatus | null>(null);
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'unread'>('newest');
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<{ to: string; subject: string; body: string; draftId?: string } | null>(null);
  useEffect(() => {
    const request = consumeLeadEmailCompose(new URL(window.location.href));
    if (!request) return;
    // Remove the request synchronously so refresh and Strict Mode cannot replay it.
    window.history.replaceState(window.history.state, '', request.url);
    if (!request.to) { toast.error('Please enter a valid email address'); return; }
    setComposeDraft({ to: request.to, subject: '', body: '' });
    setIsComposeOpen(true);
  }, [searchParams]);
  const [selectedEmail, setSelectedEmail] = useState<GmailEmail | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [syncing, setSyncing] = useState(false), [syncError, setSyncError] = useState(''), [search, setSearch] = useState('');
  const loadVersion = useRef(0);
  const syncPending = useRef(false);
  const [connectionError, setConnectionError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const cooldownUntil = useRef(0);
  const displayedQuery = useRef('');
  const pageTokenRef = useRef<string | undefined>(undefined);
  const pageRef = useRef(1);
  const applyCooldown = useCallback((error: unknown) => {
    if ((error as ApiRequestError)?.code !== 'GMAIL_RATE_LIMITED') return false;
    const provided = Date.parse((error as ApiRequestError).retryAt ?? '');
    const until = Number.isFinite(provided) && provided > Date.now() ? provided : Date.now() + 60000;
    cooldownUntil.current = Math.max(cooldownUntil.current, until);
    setClock(Date.now()); setRetryAt(cooldownUntil.current);
    return true;
  }, []);
  const paused = retryAt > 0;
  const retrySeconds = Math.max(1, Math.ceil((retryAt - clock) / 1000));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch connection status on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    setConnectionError(url.searchParams.get('gmail_error') ?? '');
    if (url.searchParams.has('gmail_error') || url.searchParams.has('gmail_connected')) {
      url.searchParams.delete('gmail_error'); url.searchParams.delete('gmail_connected'); window.history.replaceState({}, '', url);
    }
    setIsLoadingStatus(true);
    getGmailStatus()
      .then((status) => {
        setConnectionStatus(status);
      })
      .catch((error) => {
        setConnectionError(error instanceof Error ? error.message : 'Unable to check work email connection.');
        setConnectionStatus({ isConnected: false, email: null, connectedAt: null, lastSyncAt: null });
      })
      .finally(() => setIsLoadingStatus(false));
  }, []);

  const sync = useCallback(async () => {
    if (syncPending.current || cooldownUntil.current > Date.now()) return false;
    syncPending.current = true; setSyncing(true); setSyncError('');
    try {
      const result = await syncGmail();
      setConnectionStatus(await getGmailStatus());
      if (result.hasMore) setSyncError('Sync is continuing. Older conversations are loading in the background.');
      return result;
    } catch (error) { if (!applyCooldown(error)) setSyncError(error instanceof Error ? error.message : 'Email sync failed.'); return false; }
    finally { syncPending.current = false; setSyncing(false); }
  }, [applyCooldown]);

  const getQueryForViewAndCategory = (view: InboxView, category: InboxCategory): string => {
    let baseQuery = '';

    if (view === 'all') baseQuery = '-in:spam -in:trash -in:drafts';
    else if (view === 'sent') baseQuery = 'in:sent';
    else if (view === 'done') baseQuery = 'is:read -in:inbox';
    else if (view === 'future') baseQuery = 'in:snoozed OR in:scheduled';
    else if (view === 'drafts') baseQuery = 'in:drafts';
    else {
      // Current view — filter by category
      switch (category) {
        case 'primary':
          baseQuery = 'in:inbox category:primary';
          break;
        case 'promotions':
          baseQuery = 'in:inbox category:promotions';
          break;
        case 'social':
          baseQuery = 'in:inbox category:social';
          break;
        case 'updates':
          baseQuery = 'in:inbox category:updates';
          break;
        default:
          baseQuery = 'in:inbox';
      }
    }

    // Append filter query if set
    if (filterQuery) {
      baseQuery = `${baseQuery} ${filterQuery}`;
    }

    return `${baseQuery} ${debouncedSearch.trim()}`.trim();
  };

  const loadEmails = useCallback(async (view?: InboxView, category?: InboxCategory, pageToken?: string, page = 1): Promise<void> => {
    const query = getQueryForViewAndCategory(view ?? activeView, category ?? activeCategory);
    if (displayedQuery.current !== query) {
      displayedQuery.current = query;
      setEmails([]); setNextPageToken(undefined); setCurrentPage(1);
      pageTokenRef.current = undefined; pageRef.current = 1;
    }
    const version = ++loadVersion.current;
    if (cooldownUntil.current > Date.now()) { setIsLoadingEmails(false); return; }
    setIsLoadingEmails(true);
    setEmailError(null);
    try {
      const result = await fetchGmailEmails({ maxResults: 30, query, pageToken });
      if (version !== loadVersion.current) return;
      setEmails(result.emails);
      setNextPageToken(result.nextPageToken);
      pageTokenRef.current = pageToken; pageRef.current = page; setCurrentPage(page);
    } catch (err) {
      if (version === loadVersion.current && !applyCooldown(err)) {
        setEmailError(err instanceof Error ? err.message : 'Failed to load emails');
        if ([401, 403].includes((err as ApiRequestError).status ?? 0)) setEmails([]);
      }
    } finally {
      if (version === loadVersion.current) setIsLoadingEmails(false);
    }
  }, [activeView, activeCategory, filterQuery, debouncedSearch, applyCooldown]);

  useEffect(() => {
    if (!connectionStatus?.isConnected) return;
    let active = true;
    const run = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await sync();
      if (active && result && (result.processed ?? 0) > 0) void loadEmails(undefined, undefined, pageTokenRef.current, pageRef.current);
    };
    // Let the visible inbox finish before starting background work.
    const initial = setTimeout(() => void run(), 15000);
    const timer = setInterval(() => void run(), 5 * 60000);
    return () => { active = false; clearTimeout(initial); clearInterval(timer); };
  }, [connectionStatus?.isConnected, sync, loadEmails]);

  useEffect(() => {
    if (connectionStatus?.isConnected) void loadEmails();
    return () => { loadVersion.current++; };
  }, [connectionStatus?.isConnected, loadEmails]);

  useEffect(() => {
    if (!retryAt || !connectionStatus?.isConnected) return;
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    const timer = setTimeout(() => {
      cooldownUntil.current = 0; setRetryAt(0); setSyncError('');
      void loadEmails(undefined, undefined, pageTokenRef.current, pageRef.current);
    }, Math.max(0, retryAt - Date.now()) + 250);
    return () => { clearInterval(ticker); clearTimeout(timer); };
  }, [retryAt, connectionStatus?.isConnected, loadEmails]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    };
    if (isDropdownOpen || isFilterOpen || isSortOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, isFilterOpen, isSortOpen]);

  const activeViewLabel = VIEW_OPTIONS.find((v) => v.id === activeView)?.label ?? 'Current';
  const isConnected = connectionStatus?.isConnected === true;
  const emailCount = emails.length;

  // Sort emails based on sortOrder
  const sortedEmails = [...emails].sort((a, b) => {
    if (sortOrder === 'oldest') {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    }
    if (sortOrder === 'unread') {
      if (!a.isRead && b.isRead) return -1;
      if (a.isRead && !b.isRead) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }
    // newest first (default)
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const handleNextPage = (): void => {
    if (nextPageToken) {
      void loadEmails(undefined, undefined, nextPageToken, currentPage + 1);
    }
  };

  const handlePrevPage = (): void => {
    if (currentPage > 1) {
      loadEmails();
    }
  };

  const handleEmailClick = (email: GmailEmail): void => {
    if (activeView === 'drafts') {
      // Open compose modal pre-filled with draft content
      setComposeDraft({
        to: email.to.join(', '),
        subject: email.subject,
        body: email.body,
        draftId: email.draftId,
      });
      setIsComposeOpen(true);
    } else {
      setSelectedEmail(email);
    }
  };

  const contentAnimation = shouldReduceMotion
    ? {}
    : { initial: { opacity: 0, y: 15 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 } };

  const renderContent = (): React.ReactElement => {
    if (isLoadingStatus) {
      return (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      );
    }

    // Not connected — show connect empty state
    if (!isConnected) return <InboxCurrentEmpty />;

    if (isLoadingEmails && emails.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-96 gap-3">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading emails...</p>
        </div>
      );
    }

    if (paused && emails.length === 0) {
      return <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="rounded-2xl bg-blue-50 p-4 text-blue-600 dark:bg-blue-950/40"><Mail className="h-7 w-7" /></div>
        <h2 className="text-base font-semibold">Waiting for Gmail</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Google has temporarily paused mailbox requests. Your connection is still active.</p>
        <p className="text-xs text-muted-foreground">Updates will resume automatically.</p>
      </div>;
    }

    if (emailError && emails.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-96 px-6 text-center">
          <p className="text-sm text-red-500 dark:text-red-400 mb-3">{emailError}</p>
          <button
            onClick={() => loadEmails()}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      );
    }

    // Show empty states only when there are no emails
    if (emails.length === 0) {
      if (activeView === 'done') return <InboxDoneEmpty />;
      if (activeView === 'future') return <InboxFutureEmpty />;
      if (activeView === 'drafts') {
        return (
          <div className="flex flex-col items-center justify-center h-full px-6 py-16">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-500/10 border border-slate-500/20 mb-6">
              <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </div>
            <h3 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
              No drafts
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Saved drafts will appear here. Click Compose to start writing.
            </p>
          </div>
        );
      }
    }

    return <InboxEmailList emails={sortedEmails} refreshDisabled={paused || isLoadingEmails} onEmailsChanged={() => loadEmails(undefined, undefined, pageTokenRef.current, pageRef.current)} totalCount={emailCount} onEmailClick={handleEmailClick} currentPage={currentPage} hasNextPage={!!nextPageToken} onNextPage={handleNextPage} onPrevPage={handlePrevPage} />;
  };

  // If an email is selected, show the detail view
  if (selectedEmail) {
    return (
      <motion.div {...contentAnimation} className="flex min-w-0 flex-col h-full -m-3 sm:-m-4 lg:-m-6">
        <div className="flex-1 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] mx-6 mt-6">
          <EmailConversationView
            email={selectedEmail}
            onBack={() => setSelectedEmail(null)}
            onEmailsChanged={() => { loadEmails(); setSelectedEmail(null); }}
          />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...contentAnimation} className="flex min-w-0 flex-col h-full -m-3 sm:-m-4 lg:-m-6">
      {/* Page Header */}
      <div className="px-6 pt-6 pb-0 shrink-0">
        {/* Title row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Inbox
            </h1>

            {/* View dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                aria-haspopup="listbox"
                aria-expanded={isDropdownOpen}
                aria-label={`View: ${activeViewLabel}`}
              >
                <span>{activeViewLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full left-0 mt-1.5 w-44 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg py-1 z-10"
                    role="listbox"
                    aria-label="Inbox view options"
                  >
                    {VIEW_OPTIONS.map((option) => {
                      const isActive = activeView === option.id;
                      return (
                        <button
                          key={option.id}
                          onClick={() => {
                            setActiveView(option.id);
                            setIsDropdownOpen(false);
                          }}
                          className={`
                            w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors cursor-pointer
                            ${isActive
                              ? 'bg-blue-600/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]'}
                          `}
                          role="option"
                          aria-selected={isActive}
                        >
                          {isActive && <Check className="w-4 h-4 text-blue-500" />}
                          {!isActive && <span className="w-4" />}
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Header actions — Filter & Sort */}
          <div className="flex items-center gap-2">
            {/* Filter dropdown */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => { setIsFilterOpen((prev) => !prev); setIsSortOpen(false); }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border',
                  filterQuery
                    ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                    : 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                )}
                aria-label="Filter emails"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filter</span>
                {filterQuery && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </button>

              <AnimatePresence>
                {isFilterOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full right-0 mt-1.5 w-56 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg py-1 z-10"
                  >
                    <p className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                      Filter by
                    </p>
                    {[
                      { label: 'All emails', query: '' },
                      { label: 'Unread only', query: 'is:unread' },
                      { label: 'Has attachment', query: 'has:attachment' },
                      { label: 'From me', query: 'from:me' },
                    ].map((option) => (
                      <button
                        key={option.label}
                        onClick={() => {
                          setFilterQuery(option.query);
                          setIsFilterOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer',
                          filterQuery === option.query
                            ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                        )}
                      >
                        {filterQuery === option.query && <Check className="w-3.5 h-3.5 text-blue-500" />}
                        {filterQuery !== option.query && <span className="w-3.5" />}
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sort dropdown */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => { setIsSortOpen((prev) => !prev); setIsFilterOpen(false); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                aria-label="Sort emails"
              >
                <ArrowDownAZ className="w-3.5 h-3.5" />
                <span>Sort</span>
              </button>

              <AnimatePresence>
                {isSortOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute top-full right-0 mt-1.5 w-48 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg py-1 z-10"
                  >
                    <p className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                      Sort by
                    </p>
                    {[
                      { label: 'Newest first', value: 'newest' as const },
                      { label: 'Oldest first', value: 'oldest' as const },
                      { label: 'Unread first', value: 'unread' as const },
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSortOrder(option.value);
                          setIsSortOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer',
                          sortOrder === option.value
                            ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                        )}
                      >
                        {sortOrder === option.value && <Check className="w-3.5 h-3.5 text-blue-500" />}
                        {sortOrder !== option.value && <span className="w-3.5" />}
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Category chips — LeadCRM style */}
        {isConnected && activeView === 'current' && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {[
              { id: 'primary' as const, label: 'Primary', icon: Inbox, color: 'blue' },
              { id: 'promotions' as const, label: 'Promotions', icon: Tag, color: 'emerald' },
              { id: 'social' as const, label: 'Social', icon: Users, color: 'violet' },
              { id: 'updates' as const, label: 'Updates', icon: Info, color: 'amber' },
            ].map((tab) => {
              const isActive = activeCategory === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer border',
                    isActive && tab.color === 'blue' && 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/60',
                    isActive && tab.color === 'emerald' && 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60',
                    isActive && tab.color === 'violet' && 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/60',
                    isActive && tab.color === 'amber' && 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
                    !isActive && 'border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-700 dark:hover:text-slate-300',
                  )}
                  aria-label={tab.label}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {connectionError && <p role="alert" className="mx-3 my-2 break-words text-sm text-red-600 sm:mx-6">{connectionError}</p>}
      {isConnected && <div className="mx-3 my-3 min-w-0 space-y-2 sm:mx-6">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="min-w-0 break-all">Work email: {connectionStatus?.email}</span>
          <button disabled={syncing || paused || isLoadingEmails} onClick={() => void sync().then(ok => { if (ok) void loadEmails(); })} className="min-h-9 rounded border px-3 disabled:opacity-50">{syncing ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={() => { void disconnectGmail().then(() => { loadVersion.current++; cooldownUntil.current = 0; setRetryAt(0); setConnectionStatus(null); setEmails([]); }).catch(error => setSyncError(error.message)); }} className="min-h-9 rounded border px-3">Disconnect</button>
        </div>
        <input aria-label="Search email" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search email…" className="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm" />
        {paused && <div role="status" className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>Gmail updates are paused. {emails.length > 0 && 'Your loaded emails are still available. '}Retrying automatically in {retrySeconds}s.</span></div>}
        {emailError && emails.length > 0 && <p role="alert" className="text-xs text-red-600">Could not refresh emails. {emailError}</p>}
        {syncError && <p role="status" className="text-xs text-muted-foreground">{syncError}</p>}
      </div>}

      {/* Content area */}
      <div className="min-w-0 flex-1 overflow-y-auto rounded-t-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] mx-3 sm:mx-6">
        {renderContent()}
      </div>

      {/* Floating Compose Button — hide when compose is open */}
      {isConnected && !isComposeOpen && (
        <button
          onClick={() => { setComposeDraft(null); setIsComposeOpen(true); }}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2.5 h-14 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xl shadow-blue-500/30 active:scale-95 transition-all cursor-pointer"
          aria-label="Compose new email"
        >
          <Pencil className="w-5 h-5" />
          <span className="hidden sm:inline">Compose</span>
        </button>
      )}

      {/* Compose Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => { setIsComposeOpen(false); setComposeDraft(null); }}
        onSent={() => loadEmails()}
        initialDraft={composeDraft}
      />
    </motion.div>
  );
}
