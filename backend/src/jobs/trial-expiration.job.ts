/**
 * Trial / Past-Due Expiration Job
 *
 * Two responsibilities:
 *
 * 1. LEGACY: Transitions TRIAL tenants whose trialEndsAt has passed and who have
 *    no active Subscription into EXPIRED status. LeadCRM no longer creates tenants
 *    with TRIAL status, but any tenant that registered before this change may still
 *    be on TRIAL. This keeps backward compatibility.
 *
 * 2. PAST_DUE expiry: Transitions PAST_DUE tenants whose subscriptionEndsAt has
 *    passed the configured grace window (PAST_DUE_GRACE_DAYS, default 7) into
 *    CANCELLED status and reverts Tenant.status to SANDBOX.
 *
 * Safety guards:
 *   - Skips any tenant that has a live ACTIVE Subscription record
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

/** Grace period in days before a PAST_DUE tenant is cancelled */
const PAST_DUE_GRACE_DAYS = parseInt(process.env.PAST_DUE_GRACE_DAYS ?? '7', 10);

// ─── Legacy Trial Expiration ──────────────────────────────────────────────────

async function runTrialExpirationCheck(): Promise<void> {
  const now = new Date();

  // Only targets tenants still on the legacy TRIAL status (no longer assigned to new tenants)
  let expiredTenants: { id: string }[];
  try {
    expiredTenants = await prisma.tenant.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lt: now },
        subscriptions: {
          none: { status: { in: ['ACTIVE'] } },
        },
      },
      select: { id: true },
    });
  } catch (err: unknown) {
    console.error('[trial-expiration] Failed to query expired tenants:', err instanceof Error ? err.message : err);
    return;
  }

  if (expiredTenants.length === 0) return;

  console.log(`[trial-expiration] Found ${expiredTenants.length} legacy TRIAL tenant(s) to expire.`);

  for (const { id: tenantId } of expiredTenants) {
    try {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: 'EXPIRED' },
      });
      invalidatePlanCache(tenantId);
      await writeAuditLog({
        tenantId,
        userId: 'system_job',
        action: 'subscription.trial_expired',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { previousStatus: 'TRIAL', newStatus: 'EXPIRED', triggeredBy: 'trial-expiration-job' },
      });
      console.log(`[trial-expiration] Tenant ${tenantId}: TRIAL → EXPIRED`);
    } catch (err: unknown) {
      console.error(`[trial-expiration] Failed to expire tenant ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ─── Past-Due Expiry ──────────────────────────────────────────────────────────

async function runPastDueExpiryCheck(): Promise<void> {
  const graceCutoff = new Date(Date.now() - PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // PAST_DUE tenants whose subscriptionEndsAt is past the grace window and have
  // no active Subscription
  let pastDueTenants: { id: string }[];
  try {
    pastDueTenants = await prisma.tenant.findMany({
      where: {
        subscriptionStatus: 'PAST_DUE',
        subscriptionEndsAt: { lt: graceCutoff },
        subscriptions: {
          none: { status: 'ACTIVE' },
        },
      },
      select: { id: true },
    });
  } catch (err: unknown) {
    console.error('[past-due-expiry] Failed to query past-due tenants:', err instanceof Error ? err.message : err);
    return;
  }

  if (pastDueTenants.length === 0) return;

  console.log(`[past-due-expiry] Found ${pastDueTenants.length} PAST_DUE tenant(s) past grace window.`);

  for (const { id: tenantId } of pastDueTenants) {
    try {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'CANCELLED',
          plan: null,
          status: 'SANDBOX', // Revoke production access
        },
      });
      invalidatePlanCache(tenantId);
      await writeAuditLog({
        tenantId,
        userId: 'system_job',
        action: 'subscription.past_due_expired',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: {
          previousStatus: 'PAST_DUE',
          newStatus: 'CANCELLED',
          graceDays: PAST_DUE_GRACE_DAYS,
          triggeredBy: 'past-due-expiry-job',
        },
      });
      console.log(`[past-due-expiry] Tenant ${tenantId}: PAST_DUE → CANCELLED (grace window exceeded)`);
    } catch (err: unknown) {
      console.error(`[past-due-expiry] Failed to cancel tenant ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the expiration background job.
 * Handles both legacy TRIAL expiry and PAST_DUE grace window enforcement.
 * Runs immediately on startup, then every 6 hours.
 * Called from server.ts inside the app.listen callback.
 */
export function startTrialExpirationJob(): void {
  const runAll = () =>
    Promise.all([runTrialExpirationCheck(), runPastDueExpiryCheck()]).catch((err: unknown) => {
      console.error('[expiration-job] Check failed:', err instanceof Error ? err.message : err);
    });

  runAll();
  setInterval(runAll, EXPIRATION_CHECK_INTERVAL_MS);

  console.log('[expiration-job] Expiration job started (trial + past-due, runs every 6h).');
}
