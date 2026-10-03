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
  to: z.union([recipient, z.array(recipient).min(1).max(50)]),
  subject: header,
  body: z.string().trim().min(1).max(200000),
  replyToMessageId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
}).strict();

export interface MailboxEmail {
  id: string;
  threadId: string;
  draftId?: string;
  from: string;
  to: string[];
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
  readyToClose?: boolean;
}

export interface MailboxUnreadCount { unreadCount: number }
