"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NOTIFICATION_PREFERENCES = exports.NotificationPreferencesSchema = exports.NotificationQuerySchema = exports.NotificationTypes = exports.DeleteNotificationsSchema = void 0;
const zod_1 = require("zod");
exports.DeleteNotificationsSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string().uuid()).min(1).max(500).transform(ids => [...new Set(ids)]),
}).strict();
exports.NotificationTypes = [
    'lead_assigned', 'contact_assigned', 'account_assigned', 'deal_assigned', 'task_assigned',
    'customer_hot', 'customer_cold', 'customer_cancelled', 'deal_progressed', 'deal_won', 'deal_lost',
    'closing_requirements_needed', 'closing_requirements_completed', 'task_due', 'task_overdue',
    'customer_reply', 'campaign_failed', 'workflow_failed', 'user_created', 'user_status_changed',
    'mailbox_disconnected', 'mailbox_sync_failed', 'form_processing_failed', 'record_archived', 'record_restored',
];
exports.NotificationQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).max(10000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    isRead: zod_1.z.enum(['true', 'false']).optional(),
    unreadOnly: zod_1.z.enum(['true', 'false']).optional(),
    cursor: zod_1.z.string().max(1024).optional(),
    snapshot: zod_1.z.string().datetime().optional(),
}).strict();
exports.NotificationPreferencesSchema = zod_1.z.object({
    leadAssignmentEmail: zod_1.z.literal(false),
    dailyPipelineBriefing: zod_1.z.literal(false),
    urgentHotLeadSms: zod_1.z.literal(false),
    inAppGeneral: zod_1.z.boolean(),
}).strict();
exports.DEFAULT_NOTIFICATION_PREFERENCES = {
    leadAssignmentEmail: false, dailyPipelineBriefing: false, urgentHotLeadSms: false, inAppGeneral: true,
};
