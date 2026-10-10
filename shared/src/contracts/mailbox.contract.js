"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailboxBulkActionSchema = exports.MailboxConversationPageSchema = exports.MailboxConversationIdSchema = exports.ScheduleMailboxEmailSchema = exports.MailboxListSchema = exports.SaveMailboxDraftSchema = exports.MailboxReadStateSchema = exports.MAILBOX_FILTERS = exports.SendMailboxEmailSchema = exports.ClosedWonConfirmationSchema = exports.CLOSED_WON_CONFIRMATION_TYPES = void 0;
const zod_1 = require("zod");
exports.CLOSED_WON_CONFIRMATION_TYPES = ['Approved Quotation', 'Signed/Approved Contract', 'Purchase Order Received', 'Order Confirmed', 'Other'];
exports.ClosedWonConfirmationSchema = zod_1.z.object({
    type: zod_1.z.enum(exports.CLOSED_WON_CONFIRMATION_TYPES),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a Closed Won date').refine(value => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() <= Date.now() + 86400000;
    }, 'Choose a valid date that is not in the future'),
    note: zod_1.z.string().trim().max(2000).optional(),
}).strict().refine(value => value.type !== 'Other' || !!value.note?.trim(), { path: ['note'], message: 'Explain how the sale was confirmed' });
const header = zod_1.z.string().trim().min(1).max(998).refine(value => !/[\r\n]/.test(value), 'Invalid email header');
const recipient = zod_1.z.string().trim().max(254).email().refine(value => !/[\r\n]/.test(value), 'Invalid email address');
exports.SendMailboxEmailSchema = zod_1.z.object({
    requestId: zod_1.z.string().uuid().optional(),
    to: zod_1.z.union([recipient, zod_1.z.array(recipient).min(1).max(50)]),
    subject: header,
    body: zod_1.z.string().trim().min(1).max(200000),
    replyToMessageId: zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
    forwardSourceMessageId: zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
    draftId: zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
}).strict();
exports.MAILBOX_FILTERS = ['all', 'unread', 'sent', 'scheduled', 'drafts'];
exports.MailboxReadStateSchema = zod_1.z.object({ isRead: zod_1.z.boolean() }).strict();
exports.SaveMailboxDraftSchema = zod_1.z.object({
    to: zod_1.z.string().max(998).refine(value => !/[\r\n]/.test(value)),
    subject: zod_1.z.string().max(998).refine(value => !/[\r\n]/.test(value)),
    body: zod_1.z.string().max(200000),
    draftId: zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
    replyToMessageId: exports.SendMailboxEmailSchema.shape.replyToMessageId,
    forwardSourceMessageId: exports.SendMailboxEmailSchema.shape.forwardSourceMessageId,
}).strict();
exports.MailboxListSchema = zod_1.z.object({
    filter: zod_1.z.enum(exports.MAILBOX_FILTERS).default('all'),
    sort: zod_1.z.enum(['newest', 'oldest', 'unread']).default('newest'),
    query: zod_1.z.string().trim().max(1000).optional(),
    maxResults: zod_1.z.coerce.number().int().min(1).max(50).default(30),
    pageToken: zod_1.z.string().max(2000).optional(),
});
exports.ScheduleMailboxEmailSchema = exports.SendMailboxEmailSchema.extend({
    scheduledAt: zod_1.z.string().datetime().refine(value => Date.parse(value) > Date.now(), 'Choose a future date and time'),
    requestId: zod_1.z.string().uuid(),
    draftId: zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200).optional(),
}).strict();
const providerId = zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
exports.MailboxConversationIdSchema = zod_1.z.string().regex(/^c_[a-f0-9]{32}$/);
exports.MailboxConversationPageSchema = zod_1.z.object({
    maxResults: zod_1.z.coerce.number().int().min(1).max(50).default(50),
    pageToken: zod_1.z.string().max(2000).optional(),
});
exports.MailboxBulkActionSchema = zod_1.z.union([
    zod_1.z.object({ conversationIds: zod_1.z.array(exports.MailboxConversationIdSchema).min(1).max(100) }).strict(),
    zod_1.z.object({ threadIds: zod_1.z.array(providerId).min(1).max(100) }).strict(),
    zod_1.z.object({ messageIds: zod_1.z.array(providerId).min(1).max(100) }).strict(),
]);
