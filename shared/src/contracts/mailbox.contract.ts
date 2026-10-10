import { z } from 'zod';

export const CLOSED_WON_CONFIRMATION_TYPES = ['Approved Quotation', 'Signed/Approved Contract', 'Purchase Order Received', 'Order Confirmed', 'Other'] as const;
export const ClosedWonConfirmationSchema = z.object({
  type: z.enum(CLOSED_WON_CONFIRMATION_TYPES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a Closed Won date').refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() <= Date.now() + 86400000;
  }, 'Choose a valid date that is not in the future'),
  note: z.string().trim().max(2000).optional(),
}).strict().refine(value => value.type !== 'Other' || !!value.note?.trim(), { path: ['note'], message: 'Explain how the sale was confirmed' });
export type ClosedWonConfirmation = z.infer<typeof ClosedWonConfirmationSchema>;

const header = z.string().trim().min(1).max(998).refine(value => !/[\r\n]/.test(value), 'Invalid email header');
const recipient = z.string().trim().max(254).email().refine(value => !/[\r\n]/.test(value), 'Invalid email address');
export const SendMailboxEmailSchema = z.object({
  requestId: z.string().uuid().optional(),
  to: z.union([recipient, z.array(recipient).min(1).max(50)]),
  subject: header,
  body: z.string().trim().min(1).max(200000),
  replyToMessageId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
  forwardSourceMessageId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
  draftId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
}).strict();

export const MAILBOX_FILTERS = ['all', 'unread', 'sent', 'scheduled', 'drafts'] as const;
export const MailboxReadStateSchema = z.object({ isRead: z.boolean() }).strict();
export const SaveMailboxDraftSchema = z.object({
  to: z.string().max(998).refine(value => !/[\r\n]/.test(value)),
  subject: z.string().max(998).refine(value => !/[\r\n]/.test(value)),
  body: z.string().max(200000),
  draftId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
  replyToMessageId: SendMailboxEmailSchema.shape.replyToMessageId,
  forwardSourceMessageId: SendMailboxEmailSchema.shape.forwardSourceMessageId,
}).strict();
export const MailboxListSchema = z.object({
  filter: z.enum(MAILBOX_FILTERS).default('all'),
  sort: z.enum(['newest', 'oldest', 'unread']).default('newest'),
  query: z.string().trim().max(1000).optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(30),
  pageToken: z.string().max(2000).optional(),
});
export type MailboxListOptions = z.input<typeof MailboxListSchema>;
export const ScheduleMailboxEmailSchema = SendMailboxEmailSchema.extend({
  scheduledAt: z.string().datetime().refine(value => Date.parse(value) > Date.now(), 'Choose a future date and time'),
  requestId: z.string().uuid(),
  draftId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
}).strict();

export interface MailboxAttachment { id: string; filename: string; mimeType: string; size: number }

export interface MailboxEmail {
  id: string;
  threadId: string;
  /** Inbox identity only. Never pass this value to Gmail as a thread ID. */
  conversationId?: string;
  conversationKind?: 'person' | 'group';
  correspondentAddresses?: string[];
  rfcMessageId?: string;
  rfcInReplyTo?: string | null;
  rfcReferences?: string[];
  draftId?: string;
  from: string;
  to: string[];
  cc?: string[];
  replyToAddress?: string | null;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isRead: boolean;
  labels: string[];
  direction?: 'inbound' | 'outbound' | 'unknown';
  leadId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  needsDealAssociation?: boolean;
  scheduledStatus?: string;
  scheduleError?: string | null;
  /** Present on non-draft list rows; detail still returns individual messages. */
  messageCount?: number;
  participants?: string[];
  attachments?: MailboxAttachment[];
}

export interface MailboxUnreadCount { unreadCount: number; unreadCountUnit?: 'conversations' }

export interface ScheduledMailboxEmailDetail {
  id: string; status: string; scheduledAt: string; recipients: string[];
  subject: string; body: string; lastError: string | null; canCancel: boolean;
}

const providerId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
export const MailboxConversationIdSchema = z.string().regex(/^c_[a-f0-9]{32}$/);
export const MailboxConversationPageSchema = z.object({
  maxResults: z.coerce.number().int().min(1).max(50).default(50),
  pageToken: z.string().max(2000).optional(),
});
export interface MailboxConversationDetail {
  emails: MailboxEmail[];
  nextPageToken?: string;
  messageCount: number;
  threads: { threadId: string; dealOptions: { id: string; title: string; stage: string }[]; canAssociateDeal: boolean }[];
}
export const MailboxBulkActionSchema = z.union([
  z.object({ conversationIds: z.array(MailboxConversationIdSchema).min(1).max(100) }).strict(),
  z.object({ threadIds: z.array(providerId).min(1).max(100) }).strict(),
  z.object({ messageIds: z.array(providerId).min(1).max(100) }).strict(),
]);
