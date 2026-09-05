/**
 * Trial Expiration Job
 *
 * Transitions TRIAL tenants whose trialEndsAt has passed and who have
 * no active or trial Subscription record into EXPIRED subscription status.
 *
 * This job is the only mechanism that enforces trial end-dates.
 * Without it, tenants remain on TRIAL indefinitely.
 *
 * Safety guards:
 *   - Only processes tenants where trialEndsAt < now (null = no expiry set = skip)
 *   - Skips any tenant that has a live Subscription (ACTIVE or TRIAL status)
 *   - Invalidates plan cache after each update so subscriptionGate reflects the change
 *   - Writes an audit log entry per transition
 *   - Fails open on individual errors (one bad record never stops the batch)
 */

import prisma from '../config/database.config';
import { invalidatePlanCache } from '../shared/utils/plan-cache';
import { writeAuditLog } from '../core/audit/audit.service';

// ─── Configuration ────────────────────────────────────────────────────────────

/** How often to run the expiration check (6 hours) */
const EXPIRATION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ─── Job ─────────────────────────────────────────────────────────────────────

async function runTrialExpirationCheck(): Promise<void> {
  const now = new Date();

  // Find TRIAL tenants with a past trialEndsAt and no live Subscription
  let expiredTenants: { id: string }[];
  try {
    expiredTenants = await prisma.tenant.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lt: now },
        subscriptions: {
          none: { status: { in: ['ACTIVE', 'TRIAL'] } },
        },
      },
      select: { id: true },
    });
  } catch (err: unknown) {
    console.error(
      '[trial-expiration] Failed to query expired tenants:',
      err instanceof Error ? err.message : err,
    );
    return; // Non-fatal — retry on next interval
  }

  if (expiredTenants.length === 0) return;

  console.log(`[trial-expiration] Found ${expiredTenants.length} expired trial tenant(s) to transition.`);

  for (const { id: tenantId } of expiredTenants) {
    try {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: 'EXPIRED' },
      });

      // Invalidate plan cache so subscriptionGate blocks mutations immediately
      invalidatePlanCache(tenantId);

      // Write audit log so System Admins can see automatic lifecycle events
      await writeAuditLog({
        tenantId,
        userId: 'system_job',
        action: 'subscription.trial_expired',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { previousStatus: 'TRIAL', newStatus: 'EXPIRED', triggeredBy: 'trial-expiration-job' },
      });

      console.log(`[trial-expiration] Tenant ${tenantId} transitioned TRIAL → EXPIRED.`);
    } catch (err: unknown) {
      // Per-tenant errors are non-fatal — log and continue with the rest
      console.error(
        `[trial-expiration] Failed to expire tenant ${tenantId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the trial expiration background job.
 * Runs immediately on startup, then every 6 hours.
 * Call from server.ts inside the app.listen callback.
 */
export function startTrialExpirationJob(): void {
  // Immediate run on startup — catches any tenants expired since last deploy
  runTrialExpirationCheck().catch((err: unknown) => {
    console.error('[trial-expiration] Startup check failed:', err instanceof Error ? err.message : err);
  });

  // Recurring check every 6 hours
  setInterval(() => {
    runTrialExpirationCheck().catch((err: unknown) => {
      console.error('[trial-expiration] Scheduled check failed:', err instanceof Error ? err.message : err);
    });
  }, EXPIRATION_CHECK_INTERVAL_MS);

  console.log('[trial-expiration] Trial expiration job started (runs every 6h).');
}