'use client';

import React, { useState } from 'react';
import { ArrowLeft, Reply, Forward, Trash2, Archive, Loader2, Send } from 'lucide-react';
import { sendGmailEmail, archiveGmailEmails, trashGmailEmails, type GmailEmail } from '../services/gmail.service';
import { safeMailboxHtml as sanitizeEmailHtml } from '../services/email-html';


interface EmailDetailViewProps {
  email: GmailEmail;
  onBack: () => void;
  onEmailsChanged: () => void;
}

function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*<.+>$/);
  return match ? match[1].trim() : from.split('@')[0];
}

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ReplyMode = 'none' | 'reply' | 'forward';

export default function EmailDetailView({ email, onBack, onEmailsChanged }: EmailDetailViewProps): React.ReactElement {
  const [replyMode, setReplyMode] = useState<ReplyMode>('none');
  const [replyTo, setReplyTo] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleReply = (): void => {
    setReplyMode('reply');
    setReplyTo(email.direction === 'outbound' ? extractEmail(email.to[0] ?? '') : extractEmail(email.from));
    setReplyBody('');
    setSendError(null);
  };

  const handleForward = (): void => {
    setReplyMode('forward');
    setReplyTo('');
    setReplyBody(`\n\n---------- Forwarded message ----------\nFrom: ${email.from}\nDate: ${formatFullDate(email.date)}\nSubject: ${email.subject}\nTo: ${email.to.join(', ')}\n\n`);
    setSendError(null);
  };

  const handleSendReply = async (): Promise<void> => {
    if (!replyTo.trim()) {
      setSendError('Please specify a recipient');
      return;
    }
    if (!replyBody.trim() && replyMode === 'reply') {
      setSendError('Cannot send an empty reply');
      return;
    }

    setIsSending(true);
    setSendError(null);

    try {
      const subject = replyMode === 'reply'
        ? (/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`)
        : `Fwd: ${email.subject}`;
      const escapedBody = replyBody.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      await sendGmailEmail(replyTo.trim(), subject, escapedBody + (replyMode === 'forward' ? sanitizeEmailHtml(email.body) : ''), replyMode === 'reply' ? email.id : undefined);
      setReplyMode('none');
      setReplyBody('');
      setReplyTo('');
      onEmailsChanged();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  const handleCancel = (): void => {
    setReplyMode('none');
    setReplyBody('');
    setReplyTo('');
    setSendError(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-6 border-b border-gray-100 dark:border-white/5 shrink-0">
        <button
          onClick={onBack}
          className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        <button
          onClick={handleReply}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/8 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
          aria-label="Reply"
        >
          <Reply className="w-3.5 h-3.5" />
          <span>Reply</span>
        </button>
        <button
          onClick={handleForward}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/8 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
          aria-label="Forward"
        >
          <Forward className="w-3.5 h-3.5" />
          <span>Forward</span>
        </button>
        <button
          onClick={() => void archiveGmailEmails([email.id]).then(onEmailsChanged).catch(error => setSendError(error.message))}
          className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Archive"
        >
          <Archive className="w-4 h-4" />
        </button>
        <button
          onClick={() => void trashGmailEmails([email.id]).then(onEmailsChanged).catch(error => setSendError(error.message))}
          className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Email content */}
      <div className="min-w-0 flex-1 overflow-auto break-words px-3 py-5 sm:px-6">
        {sendError && replyMode === 'none' && <p role="alert" className="mb-3 text-sm text-red-600">{sendError}</p>}
        {/* Subject */}
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          {email.subject || '(no subject)'}
        </h2>

        {/* Sender info */}
        <div className="flex items-start gap-3 mb-6">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {extractName(email.from).charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 break-all">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                {extractName(email.from)}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                &lt;{extractEmail(email.from)}&gt;
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                to {email.to.length > 0 ? email.to.join(', ') : 'me'}
              </span>
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 block">
              {formatFullDate(email.date)}
            </span>
          </div>
        </div>

        {/* Email body */}
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 text-[13px] leading-relaxed [&_a]:text-blue-500 [&_img]:max-w-full [&_img]:rounded-md"
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(email.body || '<p style="color:#94a3b8">(No content)</p>') }}
        />
      </div>

      {/* Reply/Forward panel */}
      {replyMode !== 'none' && (
        <div className="border-t border-gray-200 dark:border-white/5 px-6 py-4 shrink-0 bg-slate-50/50 dark:bg-white/1">
          {/* To field with Reply/Forward label inline */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
              {replyMode === 'reply' ? 'Reply to' : 'Forward to'}
            </span>
            <input
              id="reply-to"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              readOnly={replyMode === 'reply'}
              placeholder="recipient@email.com"
              className="min-w-0 flex-1 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/8 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 read-only:bg-slate-100 dark:read-only:bg-slate-800"
            />
          </div>

          {/* Body */}
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder={replyMode === 'reply' ? 'Write your reply...' : 'Add a message (optional)...'}
            className="w-full h-36 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-white/8 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 resize-y"
            aria-label={replyMode === 'reply' ? 'Reply body' : 'Forward message'}
          />

          {/* Error */}
          {sendError && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-1">{sendError}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleSendReply}
              disabled={isSending}
              className="inline-flex items-center gap-2 h-8 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium active:scale-95 transition-all cursor-pointer"
              aria-label={replyMode === 'reply' ? 'Send reply' : 'Send forward'}
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
            <button
              onClick={handleCancel}
              className="h-8 px-3 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bottom action bar when reply panel is closed */}
      {replyMode === 'none' && (
        <div className="flex items-center gap-3 px-6 py-3 border-t border-gray-100 dark:border-white/5 shrink-0">
          <button
            onClick={handleReply}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-200 dark:border-white/8 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Reply"
          >
            <Reply className="w-4 h-4" />
            <span>Reply</span>
          </button>
          <button
            onClick={handleForward}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-200 dark:border-white/8 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Forward"
          >
            <Forward className="w-4 h-4" />
            <span>Forward</span>
          </button>
        </div>
      )}
    </div>
  );
}
