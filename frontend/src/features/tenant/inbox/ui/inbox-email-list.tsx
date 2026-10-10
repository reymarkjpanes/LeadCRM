'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mail, Trash2, Archive, Loader2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mailboxDate } from '../services/email-presentation';
import { trashGmailConversations, archiveGmailConversations, GmailEmail } from '../services/gmail.service';

interface InboxEmailListProps {
  emails: GmailEmail[];
  onEmailsChanged: () => void | Promise<void>;
  refreshDisabled?: boolean;
  loading?: boolean;
  hasLoadError?: boolean;
  totalCount: number;
  onEmailClick: (email: GmailEmail) => void;
  currentPage?: number;
  hasNextPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}



function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match ? match[1].trim() : from.split('@')[0];
}

const rowId = (email: GmailEmail) => email.conversationId ?? (email.messageCount ? email.threadId : email.id);
const eligible = (email: GmailEmail) => !email.scheduledStatus && !email.labels.includes('DRAFT');

export default function InboxEmailList({ emails, onEmailsChanged, refreshDisabled = false, loading = false, hasLoadError = false, totalCount, onEmailClick, currentPage = 1, hasNextPage = false, onNextPage, onPrevPage }: InboxEmailListProps): React.ReactElement {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const refreshPending = useRef(false), mutationPending = useRef(false);

  useEffect(() => { setSelectedIds(previous => new Set([...previous].filter(id => emails.some(email => rowId(email) === id && eligible(email))))); }, [emails]);
  const selectable = emails.filter(eligible);
  const busy = loading || isRefreshing || isDeleting || isArchiving;
  const allSelected = selectable.length > 0 && selectedIds.size === selectable.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < emails.length;
  const hasSelection = selectedIds.size > 0;

  const toggleSelectAll = (): void => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map(rowId)));
    }
  };

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async (): Promise<void> => {
    if (selectedIds.size === 0 || mutationPending.current || busy || refreshDisabled) return;
    mutationPending.current = true; setError('');
    setIsDeleting(true);
    try {
      await trashGmailConversations(Array.from(selectedIds));
      setSelectedIds(new Set());
      await onEmailsChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to move emails to trash.');
    } finally {
      setIsDeleting(false);
      mutationPending.current = false;
    }
  };

  const handleArchive = async (): Promise<void> => {
    if (selectedIds.size === 0 || mutationPending.current || busy || refreshDisabled) return;
    mutationPending.current = true; setError('');
    setIsArchiving(true);
    try {
      await archiveGmailConversations(Array.from(selectedIds));
      setSelectedIds(new Set());
      await onEmailsChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to archive emails.');
    } finally {
      setIsArchiving(false);
      mutationPending.current = false;
    }
  };

  const handleRefresh = async (): Promise<void> => {
    if (refreshPending.current || busy || refreshDisabled) return;
    refreshPending.current = true; setIsRefreshing(true); setError('');
    try {
      await onEmailsChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to refresh conversations. Try again.');
    } finally {
      refreshPending.current = false; setIsRefreshing(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error && <p role="alert" className="p-3 text-sm text-red-600">{error}</p>}
      {/* Toolbar */}
      <div role="toolbar" aria-label="Email list actions" className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-white/[0.05] bg-white dark:bg-transparent shrink-0">
        <div className="flex items-center gap-1">
          {/* Select all with dropdown */}
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={busy || refreshDisabled || selectable.length === 0}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
              aria-label="Select all emails"
            />

          </div>

          {/* Refresh — always visible */}
          <button
            onClick={handleRefresh}
            disabled={refreshDisabled || busy}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </button>

          {/* Bulk actions — visible when selection active */}
          {hasSelection && (
            <>
              <button
                onClick={handleArchive}
                disabled={refreshDisabled || busy}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                aria-label="Archive"
                title="Archive all authorized messages in selected histories"
              >
                {isArchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              </button>
              <button
                onClick={handleDelete}
                disabled={refreshDisabled || busy}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                aria-label="Delete"
                title="Move all authorized messages in selected histories to trash"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>

            </>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {emails.length ? `${((currentPage - 1) * 30) + 1}–${((currentPage - 1) * 30) + emails.length}` : '0'}{hasNextPage ? ' +' : ''}
          </span>
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1 || refreshDisabled || busy}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNextPage}
            disabled={!hasNextPage || refreshDisabled || busy}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* "All selected" banner */}
      {allSelected && (
        <div className="px-4 py-2 text-center text-xs text-slate-600 dark:text-slate-400 bg-blue-50/50 dark:bg-blue-950/20 border-b border-gray-100 dark:border-white/[0.05] shrink-0">
          All <strong>{selectable.length}</strong> histories on this page are selected. Actions affect all authorized messages in each selected history.{' '}

        </div>
      )}

      {/* Email list */}
      <div aria-busy={loading || isRefreshing} data-mailbox-list className="min-h-0 flex-1 overflow-y-auto">
        {loading || isRefreshing ? <div role="status" aria-label="Loading conversations" className="flex min-h-64 h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading emails...</div> : <>
        {emails.length === 0 && !hasLoadError && !error && (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <Mail className="mb-4 h-6 w-6 text-slate-400" />
            <p className="text-sm font-medium text-slate-900 dark:text-white">No emails found</p>
            <p className="mt-1 text-xs text-slate-500">No messages match this view.</p>
          </div>
        )}
        {emails.map((email) => {
          const isSelected = selectedIds.has(rowId(email));
          return (
            <div
              key={rowId(email)}
              className={cn(
                'flex items-center gap-0 px-3 sm:px-5 py-3 border-b border-gray-100 dark:border-white/[0.03] hover:shadow-sm transition-all',
                !email.isRead && 'bg-white dark:bg-white/[0.03]',
                email.isRead && 'bg-slate-50/50 dark:bg-transparent',
                isSelected && 'bg-blue-50 dark:bg-blue-950/30',
                'hover:bg-slate-50 dark:hover:bg-white/[0.02]',
              )}
            >
              {/* Checkbox */}
              <div className="shrink-0 pr-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!eligible(email) || refreshDisabled || busy}
                  onChange={() => toggleSelect(rowId(email))}
                  className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer"
                  aria-label={`Select email from ${extractName(email.from)}`}
                />
              </div>

              {/* Email content — clickable row */}
              <button
                onClick={() => onEmailClick(email)}
                className="flex-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1 min-w-0 text-left cursor-pointer py-0.5 md:flex"
                aria-label={email.scheduledStatus ? `Review scheduled email: ${email.subject}` : `Open email from ${extractName(email.from)}: ${email.subject}`}
              >
                {/* Sender */}
                <span
                  className={cn(
                    'col-start-1 row-start-1 flex min-w-0 md:w-[180px] md:shrink-0 text-[13px] pr-2 md:pr-4',
                    !email.isRead
                      ? 'font-bold text-slate-900 dark:text-white'
                      : 'font-normal text-slate-700 dark:text-slate-400',
                  )}
                >
                  <span className="min-w-0 truncate">{email.participants?.length ? email.participants.join(', ') : email.direction === 'outbound' ? `You → ${extractName(email.to[0] ?? '')}` : extractName(email.from)}</span>{(email.messageCount ?? 0) > 0 && <span className="ml-1 shrink-0" aria-label={`${email.messageCount} messages`}>({email.messageCount})</span>}
                </span>

                {/* Subject + Snippet */}
                <div className="col-span-2 row-start-2 flex-1 flex flex-col items-start gap-0.5 min-w-0 overflow-hidden md:flex-row md:items-center">
                  <span
                    className={cn(
                      'max-w-full md:max-w-[55%] shrink-0 truncate text-[13px]',
                      !email.isRead
                        ? 'font-bold text-slate-900 dark:text-white'
                        : 'font-normal text-slate-600 dark:text-slate-400',
                    )}
                  >
                    {email.subject || '(no subject)'}
                  </span>
                  <span className="max-w-full text-xs md:text-[13px] text-muted-foreground truncate">
                    {email.scheduledStatus ? email.scheduledStatus + ' · ' : '— '}{email.snippet}
                  </span>
                </div>

                {/* Date */}
                <span
                  className={cn(
                    'col-start-2 row-start-1 shrink-0 text-xs pl-2 md:pl-4',
                    !email.isRead
                      ? 'font-bold text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-500',
                  )}
                >
                  {email.scheduledStatus ? new Date(email.date).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : mailboxDate(email.date)}
                </span>
              </button>
            </div>
          );
        })}
        </>}
      </div>
    </div>
  );
}
