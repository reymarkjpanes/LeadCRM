import { manilaLocalDateTime } from '@/lib/manila-time';
import type { GmailEmail } from './gmail.service';
import { safeMailboxHtml } from './email-html';

export const emailAddress = (value: string) => (value.match(/<([^<>]+)>/)?.[1] ?? value).trim();
export const senderName = (value: string) => (value.match(/^(.+?)\s*<[^<>]+>$/)?.[1] ?? value.split('@')[0]).replace(/^"|"$/g, '').trim();
export function mailboxDate(value: string, full = false, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return 'Date unavailable';
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Manila' };
  if (full) return date.toLocaleString('en-PH', { ...options, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const day = manilaLocalDateTime(date).slice(0, 10);
  if (day === manilaLocalDateTime(now).slice(0, 10)) return date.toLocaleTimeString('en-PH', { ...options, hour: 'numeric', minute: '2-digit' });
  if (day === manilaLocalDateTime(new Date(+now - 86400000)).slice(0, 10)) return 'Yesterday';
  return date.toLocaleDateString('en-PH', { ...options, month: 'short', day: 'numeric', ...(day.slice(0, 4) !== manilaLocalDateTime(now).slice(0, 4) ? { year: 'numeric' } : {}) });
}
export type MailboxComposeDraft = { to: string; subject: string; body: string; replyToMessageId?: string; forwardSourceMessageId?: string; draftId?: string };
export function replyDraft(email: GmailEmail): MailboxComposeDraft {
  return { to: email.direction === 'outbound' ? emailAddress(email.to[0] ?? '') : email.replyToAddress || emailAddress(email.from), subject: /^\s*re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`, body: '', replyToMessageId: email.id };
}
export function replyAllDraft(email: GmailEmail, mailbox: string): MailboxComposeDraft {
  const draft = replyDraft(email);
  const addresses = [draft.to, ...email.to, ...(email.cc ?? [])].map(emailAddress);
  const seen = new Set<string>([mailbox.trim().toLowerCase()]);
  const recipients = addresses.filter(address => {
    const key = address.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { ...draft, to: recipients.join(', ') };
}
export function forwardDraft(email: GmailEmail): MailboxComposeDraft {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { to: '', subject: /^\s*fwd:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`, forwardSourceMessageId: email.id,
    body: '<p><br></p><p>---------- Forwarded message ----------<br>From: ' + escape(email.from) + '<br>Date: ' + escape(mailboxDate(email.date, true)) + '<br>Subject: ' + escape(email.subject) + '<br>To: ' + escape(email.to.join(', ')) + (email.cc?.length ? '<br>Cc: ' + escape(email.cc.join(', ')) : '') + '</p>' + safeMailboxHtml(email.body) };
}
