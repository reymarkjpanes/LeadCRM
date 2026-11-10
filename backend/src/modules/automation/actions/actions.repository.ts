import prisma from '../../../config/database.config';
import type { Prisma } from '@prisma/client';
import { workflowLeaseWrite } from '../workflows/workflow-lease';
export function findAccount(id: string, tenantId: string) {
  return prisma.account.findFirst({ where: { id, tenantId, isArchived: false } });
}
export function findUser(id: string, tenantId: string, db: Prisma.TransactionClient = prisma) {
  return db.user.findFirst({ where: { id, tenantId, status: 'ACTIVE' }, select: { id: true, role: true } });
}
export function findPipeline(id: string, tenantId: string) {
  return prisma.pipeline.findFirst({ where: { id, tenantId, isArchived: false } });
}
export function findCampaign(id: string, tenantId: string) {
  return prisma.campaign.findFirst({ where: { id, tenantId, isArchived: false } });
}
export function findTemplate(id: string, tenantId: string, db: Prisma.TransactionClient = prisma) {
  return db.template.findFirst({ where: { id, tenantId, isArchived: false, type: 'Email' } });
}
export function findStage(id: string, tenantId: string) {
  return prisma.stage.findFirst({ where: { id, tenantId, pipeline: { tenantId, isArchived: false } } });
}
export async function findSender(id: string, tenantId: string) {
  if (!await findUser(id, tenantId)) return null;
  return prisma.emailAccount.findFirst({ where: { userId: id, tenantId, isActive: true, provider: 'gmail' }, select: { email: true } });
}
export function createDelivery(data: { tenantId: string; fromEmail: string; toEmail: string; subject: string; leadId?: string; contactId?: string }, db: Prisma.TransactionClient) {
  return db.emailDeliveryLog.create({ data: { ...data, status: 'pending' } });
}
export function finishDelivery(id: string, tenantId: string, data: { status: string; gmailMessageId?: string; gmailThreadId?: string; sentAt?: Date; errorMessage?: string }) {
  return workflowLeaseWrite(tx => tx.emailDeliveryLog.update({ where: { id, tenantId }, data }));
}
