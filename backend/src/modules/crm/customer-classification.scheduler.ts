import { isWorkspaceAccessible } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { crmActor, resolveCrmActor } from './access/crm-record-access.service';
import { refreshDealClassification, classifyCustomerRecord } from './customer-classification.service';
import { salesTransaction } from './leads/lead-automation.service';

/** Continue aging verified evidence even when no mailbox or receiving device is connected. */
export async function sweepCustomerClassifications(now = new Date()) {
  const admins = await prisma.user.findMany({ where: { role: 'Client Admin', status: 'ACTIVE' },
    select: { id: true, tenantId: true, tenant: { select: { status: true } } }, orderBy: { id: 'asc' } });
  const workspaces = new Map(admins.filter(row => isWorkspaceAccessible(row.tenant.status)).map(row => [row.tenantId, row]));
  for (const [tenantId, actor] of workspaces) {
    await tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: actor.id }, async () => {
      const key = { tenantId, module: 'customer-classification', key: 'sweep-cursor' };
      const saved = await prisma.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
      const value = saved?.value;
      const positions = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const next: Record<string, string> = {};
      const dealPosition = typeof positions.deal === 'string' ? positions.deal : '';
      const deals = await prisma.deal.findMany({ where: { tenantId, isArchived: false, deletedAt: null, pipeline: { isArchived: false }, ...(dealPosition ? { id: { gt: dealPosition } } : {}) },
        orderBy: { id: 'asc' }, take: 50, select: { id: true } });
      for (const deal of deals) await salesTransaction(tx => refreshDealClassification(tx, tenantId, deal.id, actor.id, [], now, true, deal.id, 'scheduler'));
      next.deal = deals.length === 50 ? deals[deals.length - 1].id : '';
      for (const kind of ['lead', 'contact'] as const) {
        const position = typeof positions[kind] === 'string' ? positions[kind] as string : '';
        const where = { tenantId, isArchived: false, deletedAt: null, ...(position ? { id: { gt: position } } : {}) };
        const rows = kind === 'lead'
          ? await prisma.lead.findMany({ where, orderBy: { id: 'asc' }, take: 50, select: { id: true } })
          : await prisma.contact.findMany({ where, orderBy: { id: 'asc' }, take: 50, select: { id: true } });
        for (const row of rows) await salesTransaction(async tx => {
          await resolveCrmActor(tx, { tenantId, userId: actor.id });
          await classifyCustomerRecord(tx, tenantId, kind === 'lead' ? { leadId: row.id } : { contactId: row.id }, actor.id, { source: 'scheduler' }, now);
        });
        next[kind] = rows.length === 50 ? rows[rows.length - 1].id : '';
      }
      await prisma.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: next }, update: { value: next } });
    }));
  }
}

export function startCustomerClassificationScheduler() {
  let pending: Promise<void> | undefined, stopped = false;
  const tick = () => {
    if (!stopped && !pending) pending = sweepCustomerClassifications()
      .catch(() => console.error('[Customer classification] Inactivity evaluation failed; the next sweep will retry.'))
      .finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick, 300000); timer.unref(); tick();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
