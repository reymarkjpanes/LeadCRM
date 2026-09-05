/**
 * Pending Downgrade Job
 *
 * Applies scheduled subscription downgrades that have reached their
 * pendingDowngradeAt date. The Subscription model stores:
 *   - pendingPlanId:        target plan UUID
 *   - pendingBillingCycle:  target billing cycle string
 *   - pendingDowngradeAt:   when the change takes effect (typically period end)
 *
 * This job is the only mechanism that applies pending downgrades.
 * Without it, Subscription.pendingPlanId is set but never consumed.
 *
 * Safety guards:
 *   - Only processes ACTIVE subscriptions with a non-null pendingPlanId where pendingDowngradeAt < now
 *   - Resolves the target PricingPlan by pendingPlanId before committing — skips if not found
 *   - Clears all three pending fields to null after applying
 *   - Invalidates plan cache after each update so planGate reflects the change immediately
 *   - Writes an audit log entry per transition
 *   - Fails open on individual errors (one bad record never stops the batch)
 */

import prisma from '../config/database.config';
import { invalidatePlanCache } from '../shared/utils/plan-cache';
import { writeAuditLog } from '../core/audit/audit.service';

// ─── Configuration ────────────────────────────────────────────────────────────

/** How often to run the downgrade check (1 hour) */
const DOWNGRADE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// ─── Job ─────────────────────────────────────────────────────────────────────

async function runPendingDowngradeCheck(): Promise<void> {
  const now = new Date();

  // Find ACTIVE subscriptions whose scheduled downgrade date has passed
  let pendingDowngrades: {
    id: string;
    tenantId: string;
    planId: string;
    billingCycle: string;
    pendingPlanId: string | null;
    pendingBillingCycle: string | null;
  }[];

  try {
    pendingDowngrades = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        pendingPlanId: { not: null },
        pendingDowngradeAt: { lt: now },
      },
      select: {
        id: true,
        tenantId: true,
        planId: true,
        billingCycle: true,
        pendingPlanId: true,
        pendingBillingCycle: true,
      },
    });
  } catch (err: unknown) {
    console.error(
      '[pending-downgrade] Failed to query pending downgrades:',
      err instanceof Error ? err.message : err,
    );
    return; // Non-fatal — retry on next interval
  }

  if (pendingDowngrades.length === 0) return;

  console.log(`[pending-downgrade] Found ${pendingDowngrades.length} pending downgrade(s) to apply.`);

  for (const sub of pendingDowngrades) {
    if (!sub.pendingPlanId) continue; // TypeScript guard — already filtered above

    try {
      // Resolve target plan — skip if not found to avoid corrupting subscription
      const newPlan = await prisma.pricingPlan.findUnique({
        where: { id: sub.pendingPlanId },
        select: { id: true, planType: true },
      });

      if (!newPlan) {
        console.warn(
          `[pending-downgrade] Target plan ${sub.pendingPlanId} not found for subscription ${sub.id} — skipping.`,
        );
        continue;
      }

      const newBillingCycle = (sub.pendingBillingCycle ?? sub.billingCycle) as
        'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

      // Apply the downgrade atomically: update subscription + tenant plan cache
      await prisma.$transaction([
        prisma.subscription.update({
          where: { id: sub.id },
          data: {
            planId:              newPlan.id,
            billingCycle:        newBillingCycle,
            pendingPlanId:       null,
            pendingBillingCycle: null,
            pendingDowngradeAt:  null,
          },
        }),
        prisma.tenant.update({
          where: { id: sub.tenantId },
          data: { plan: newPlan.planType },
        }),
      ]);

      // Invalidate plan cache so planGate and recordLimitGate reflect new limits immediately
      invalidatePlanCache(sub.tenantId);

      // Write audit log so System Admins can see automatic lifecycle events
      await writeAuditLog({
        tenantId: sub.tenantId,
        userId:   'system_job',
        action:   'subscription.downgrade_applied',
        entityType: 'Subscription',
        entityId:   sub.id,
        metadata: {
          oldPlanId:      sub.planId,
          newPlanId:      newPlan.id,
          newPlanType:    newPlan.planType,
          billingCycle:   newBillingCycle,
          triggeredBy:    'pending-downgrade-job',
        },
      });

      console.log(
        `[pending-downgrade] Subscription ${sub.id} (tenant ${sub.tenantId}) downgraded to plan ${newPlan.planType}.`,
      );
    } catch (err: unknown) {
      // Per-subscription errors are non-fatal — log and continue with the rest
      console.error(
        `[pending-downgrade] Failed to apply downgrade for subscription ${sub.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the pending downgrade background job.
 * Runs immediately on startup, then every hour.
 * Call from server.ts inside the app.listen callback.
 */
export function startPendingDowngradeJob(): void {
  // Immediate run on startup — applies any downgrades that fired during downtime
  runPendingDowngradeCheck().catch((err: unknown) => {
    console.error('[pending-downgrade] Startup check failed:', err instanceof Error ? err.message : err);
  });

  // Recurring check every hour
  setInterval(() => {
    runPendingDowngradeCheck().catch((err: unknown) => {
      console.error('[pending-downgrade] Scheduled check failed:', err instanceof Error ? err.message : err);
    });
  }, DOWNGRADE_CHECK_INTERVAL_MS);

  console.log('[pending-downgrade] Pending downgrade job started (runs every 1h).');
}
