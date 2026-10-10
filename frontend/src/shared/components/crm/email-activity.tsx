'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { RecordSection } from './record-section';
import { safeMailboxHtml } from '@/features/tenant/inbox/services/email-html';
import type { TimelineActivity } from '@/shared/hooks/use-record-activities';

export interface ActivityEmail { id: string; providerMessageId: string; threadId: string; accountId: string; direction: string; from: string; to: string[]; subject: string; sentAt: string; body: string }
export function activityEmail(activity: TimelineActivity): ActivityEmail | undefined {
  const value = activity.metadata?.email as ActivityEmail | undefined;
  return activity.type === 'email' && value && typeof value.body === 'string' && Array.isArray(value.to) ? value : undefined;
}
export function EmailActivity({ email }: { email: ActivityEmail }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => safeMailboxHtml(email.body), [email.body]);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;
    const measure = () => {
      const hasQuotedContent = !!body.querySelector('blockquote, .gmail_quote');
      const isClipped = body.scrollHeight > body.clientHeight + 1;
      setCanExpand(hasQuotedContent || isClipped);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [email.body, expanded, html]);

  return (
    <article className="min-w-0 space-y-2 p-2.5 text-[11px] [overflow-wrap:anywhere] sm:space-y-2.5 sm:p-3 sm:text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-semibold text-foreground">{email.direction === 'inbound' ? 'Received' : 'Sent'}</span>
        <time className="text-muted-foreground tabular-nums" dateTime={email.sentAt}>{new Date(email.sentAt).toLocaleString()}</time>
      </div>
      <dl className="space-y-1 leading-4 text-muted-foreground">
        <div><dt className="inline font-medium">From: </dt><dd className="inline">{email.from}</dd></div>
        <div><dt className="inline font-medium">To: </dt><dd className="inline">{email.to.join(', ')}</dd></div>
        <div><dt className="inline font-medium">Subject: </dt><dd className="inline text-foreground">{email.subject || '(No subject)'}</dd></div>
      </dl>
      <div ref={bodyRef} data-email-body className={`min-w-0 text-xs leading-[1.2rem] text-foreground sm:text-sm sm:leading-5 ${expanded ? '' : 'max-h-32 overflow-hidden [&_blockquote]:hidden [&_.gmail_quote]:hidden'}`}>
        {/<[a-z][\s\S]*>/i.test(email.body)
          ? <div className="min-w-0 [&_*]:max-w-full [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:table-fixed [&_td]:break-words [&_pre]:whitespace-pre-wrap [&_a]:underline" dangerouslySetInnerHTML={{ __html: html }} />
          : <p className="whitespace-pre-wrap">{email.body}</p>}
      </div>
      {(canExpand || expanded) && (
        <button type="button" aria-expanded={expanded} className="inline-flex min-h-7 items-center text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300 sm:min-h-8 sm:text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'View less' : 'View more'}
        </button>
      )}
    </article>
  );
}

export function groupEmailActivities(activities: TimelineActivity[]) {
  const threads = new Map<string, TimelineActivity[]>();
  for (const activity of activities) {
    const email = activityEmail(activity);
    const subject = (email?.subject || activity.title).replace(/^(?:(?:re|fw|fwd):\s*)+/i, '').trim();
    const key = email ? `${email.accountId}:${email.threadId || subject.toLowerCase() || activity.id}` : `subject:${subject.toLowerCase() || activity.id}`;
    const entries = threads.get(key) ?? [];
    if (!entries.some(a => email && activityEmail(a)?.id === email.id)) entries.push(activity);
    threads.set(key, entries);
  }
  return [...threads.entries()].map(([key, entries]) => ({
    key,
    title: (activityEmail(entries[0])?.subject || entries[0].title).replace(/^(?:(?:re|fw|fwd):\s*)+/i, '') || '(No subject)',
    entries: [...entries].sort((a, b) => (activityEmail(b)?.sentAt || b.createdAt).localeCompare(activityEmail(a)?.sentAt || a.createdAt) || a.id.localeCompare(b.id)),
    createdAt: entries.reduce((latest, a) => a.createdAt > latest ? a.createdAt : latest, ''),
  }));
}

export function EmailThread({ thread }: { thread: ReturnType<typeof groupEmailActivities>[number] }) {
  return <RecordSection title={thread.title} count={thread.entries.length} icon={Mail}>
    <div className="divide-y divide-border">{thread.entries.map(a => {
      const email = activityEmail(a);
      return email ? <EmailActivity key={a.id} email={email} /> : <p key={a.id} className="p-3 text-sm [overflow-wrap:anywhere]">{a.title}{a.description && <span className="block whitespace-pre-wrap">{a.description}</span>}</p>;
    })}</div>
  </RecordSection>;
}

export function EmailConversations({ activities }: { activities: TimelineActivity[] }) {
  return <div className="min-w-0 space-y-3">{groupEmailActivities(activities).map(thread => <EmailThread key={thread.key} thread={thread} />)}</div>;
}
