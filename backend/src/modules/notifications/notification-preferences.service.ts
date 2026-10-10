import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferencesSchema, type NotificationPreferences } from '@leadcrm/shared';
import prisma from '../../config/database.config';

const availability = { leadAssignmentEmail: false, dailyPipelineBriefing: false, urgentHotLeadSms: false, inAppGeneral: true } as const;
const key = (tenantId: string, userId: string) => ({ tenantId, userId, module: 'notifications', key: 'channels' });
export async function getNotificationPreferences(tenantId: string, userId: string) {
  const stored = await prisma.userPreference.findUnique({ where: { tenantId_userId_module_key: key(tenantId, userId) } });
  const parsed = NotificationPreferencesSchema.safeParse(stored?.value);
  return { data: parsed.success ? parsed.data : { ...DEFAULT_NOTIFICATION_PREFERENCES }, availability };
}
export async function saveNotificationPreferences(tenantId: string, userId: string, input: NotificationPreferences) {
  const value = NotificationPreferencesSchema.parse(input);
  await prisma.userPreference.upsert({ where: { tenantId_userId_module_key: key(tenantId, userId) },
    create: { ...key(tenantId, userId), value }, update: { value } });
  return { data: value, availability };
}
export const mandatoryNotification = (type: string) => ['user_created', 'user_status_changed', 'mailbox_disconnected', 'mailbox_sync_failed'].includes(type);
