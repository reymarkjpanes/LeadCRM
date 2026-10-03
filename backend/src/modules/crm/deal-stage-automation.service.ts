import type { Prisma } from '@prisma/client';
import { DealStageAutomationSchema } from '@leadcrm/shared';
import { salesTransaction } from './leads/lead-automation.service';

const key = (tenantId: string) => ({ tenantId, module: 'deal-stage-automation', key: 'default' });
export async function readDealStageAutomation(tx: Prisma.TransactionClient, tenantId: string) {
  const row = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key(tenantId) } });
  const parsed = DealStageAutomationSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : { enabled: false };
}
export const getDealStageAutomation = (tenantId: string) => salesTransaction(tx => readDealStageAutomation(tx, tenantId));
export async function saveDealStageAutomation(tenantId: string, actorId: string, input: unknown) {
  const value = DealStageAutomationSchema.parse(input);
  return salesTransaction(async tx => {
    const before = await readDealStageAutomation(tx, tenantId);
    await tx.tenantPreference.upsert({ where: { tenantId_module_key: key(tenantId) }, create: { ...key(tenantId), value }, update: { value } });
    if (before.enabled !== value.enabled) await tx.auditLog.create({ data: { tenantId, userId: actorId,
      action: 'deal_stage_automation.updated', entityType: 'Settings', changeset: { before, after: value } } });
    return value;
  });
}
