'use client';
import React, { useId, useMemo } from 'react';
import { ChevronDown, ChevronUp, Forward, Reply, ReplyAll, Paperclip } from 'lucide-react';
import Link from 'next/link';
import type { GmailEmail } from '../services/gmail.service';
import { emailAddress, mailboxDate, senderName } from '../services/email-presentation';
import { trimmedMailboxHtml } from '../services/email-html';

export const mailboxIconButton = 'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50';

export default function EmailDetailView({ email, expanded, onToggle, onReply, onReplyAll, onForward, showContext = false, disabled = false }: {
  email: GmailEmail; expanded: boolean; onToggle: () => void; onReply: () => void; onReplyAll?: () => void; onForward: () => void; showContext?: boolean; disabled?: boolean;
}) {
  const bodyId = useId();
  const body = useMemo(() => ({ __html: trimmedMailboxHtml(email.body || '<p>(No content)</p>') }), [email.body]);
  const name = senderName(email.from), address = emailAddress(email.from);
  return <article className="min-w-0 border-b border-border px-3 py-4 sm:px-6" aria-label={`Message from ${name}`}>
    <div className="flex min-w-0 items-start gap-1 sm:gap-3">
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId} aria-label={`${expanded ? 'Collapse' : 'Expand'} message from ${name}`} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-light)] text-sm font-semibold text-[var(--primary)] sm:h-10 sm:w-10">{name.charAt(0).toUpperCase()}</span>
        <span className="block min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{name}</span>
            <span className="text-xs text-muted-foreground">&lt;{address}&gt;</span>
          </span>
          {expanded ? <><span className="mt-1 block text-xs text-muted-foreground">to {email.to.join(', ') || 'me'}</span>{!!email.cc?.length && <span className="mt-1 block text-xs text-muted-foreground">Cc: {email.cc.join(', ')}</span>}</> : <span className="mt-1 block truncate text-xs text-muted-foreground">{email.snippet || '(No content)'}</span>}
          <time dateTime={email.date} title={mailboxDate(email.date, true)} className="mt-1 block text-xs text-muted-foreground">{expanded ? mailboxDate(email.date, true) : mailboxDate(email.date)}</time>
        </span>
        <span className="mt-1 hidden shrink-0 text-muted-foreground sm:block" aria-hidden="true">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {expanded && <div className="flex shrink-0 flex-col sm:flex-row">
        <button type="button" title="Reply" aria-label={`Reply to ${name}`} className={mailboxIconButton} disabled={disabled} onClick={onReply}><Reply size={16} /></button>
        {onReplyAll && <button type="button" title="Reply All" aria-label={`Reply all to message from ${name}`} className={mailboxIconButton} disabled={disabled} onClick={onReplyAll}><ReplyAll size={16} /></button>}
        <button type="button" title="Forward" aria-label={`Forward message from ${name}`} className={mailboxIconButton} disabled={disabled} onClick={onForward}><Forward size={16} /></button>
      </div>}
    </div>
    {expanded && <div id={bodyId} className="mt-5 min-w-0 sm:pl-[52px]">
      {showContext && <div className="mb-3 space-y-2 text-xs"><p className="font-medium [overflow-wrap:anywhere]">{email.subject || '(no subject)'}</p><div className="flex flex-wrap gap-3">
        {email.leadId && <Link className="text-[var(--primary)] underline" href={`/crm/leads/${email.leadId}`}>View linked Lead</Link>}
        {email.contactId && <Link className="text-[var(--primary)] underline" href={`/crm/contacts/${email.contactId}`}>View linked Contact</Link>}
        {email.dealId && <Link className="text-[var(--primary)] underline" href={`/crm/deals/${email.dealId}`}>View related Deal</Link>}
      </div></div>}
      <div data-mailbox-body className="prose prose-sm dark:prose-invert min-w-0 max-w-full overflow-x-auto text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere] [&_p]:mb-4 [&_a]:text-[var(--primary)] [&_a]:underline [&_pre]:whitespace-pre [&_table]:max-w-none [&_table]:min-w-max [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_details]:my-3 [&_summary]:w-fit [&_summary]:cursor-pointer [&_summary]:rounded [&_summary]:px-2 [&_summary]:py-2 [&_summary]:text-xs [&_summary]:text-muted-foreground [&_summary:focus-visible]:outline-2" dangerouslySetInnerHTML={body} />
      {!!email.attachments?.length && <ul aria-label="Message attachments" className="mt-4 flex flex-wrap gap-2">{email.attachments.map(file => <li key={file.id} className="min-w-0 max-w-full"><a download href={`/api/proxy/integrations/gmail/messages/${encodeURIComponent(email.id)}/attachments/${encodeURIComponent(file.id)}`} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border px-3 text-xs text-[var(--primary)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"><Paperclip size={14} className="shrink-0" /><span className="truncate">{file.filename}</span></a></li>)}</ul>}
    </div>}
  </article>;
}
