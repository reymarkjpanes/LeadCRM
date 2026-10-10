import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { tenantContext } from '../../core/tenant/tenant-context';

// Kept separate from tenantContext: that context is spread into Prisma where clauses.
export const notificationActor = new AsyncLocalStorage<string>();
export async function setNotificationActor(tx: Prisma.TransactionClient, actorId = notificationActor.getStore()) {
  // Only this constant transaction-local setting bypasses the ORM raw-query guard.
  // Record writes still run in the authenticated tenant context.
  if (actorId) await tenantContext.exit(async () => await tx.$queryRaw`SELECT set_config('leadcrm.actor_id', ${actorId}, true)`);
}
