import prisma from '../../../config/database.config';
import { campaignScope } from './audiences.service';

export async function findCampaignReport(id: string, tenantId: string) {
  return prisma.$transaction(tx => tx.campaign.findFirst({
    where: { id, ...campaignScope(tenantId) },
    include: {
      targetAudience: { select: { name: true } },
      campaignContacts: { where: { tenantId }, orderBy: { id: 'asc' }, include: {
        lead: { select: { tenantId: true, firstName: true, lastName: true } },
        contact: { select: { tenantId: true, firstName: true, lastName: true } },
      } },
      emailDeliveryLogs: { where: { tenantId }, select: {
        toEmail: true, brevoMessageId: true, EmailEvent: { where: { tenantId }, select: { eventType: true, url: true, createdAt: true, providerEventKey: true } },
      } },
    },
  }), { isolationLevel: 'RepeatableRead' });
}
