import prisma from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { invalidatePlanCache } from '../../../shared/utils/plan-cache';
import { Role } from '../../../shared/constants/roles';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface ActivateTenantSubscriptionInput {
  tenantId:                string;
  planId:                  string;
  billingCycle:            'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  periodEnd:               Date;
  stripeSubscriptionId:    string | null;    // null for admin bypass
  stripeCheckoutSessionId: string | null;    // null for admin bypass
  activationSource:        'STRIPE_WEBHOOK' | 'SYSTEM_ADMIN_BYPASS';
  actorId:                 string;           // 'stripe_webhook' | System Admin userId
}

// ─── Shared Activation Transaction ───────────────────────────────────────────

/**
 * activateTenantSubscription
 *
 * The single authoritative function for transitioning a tenant from
 * SANDBOX to ACTIVE and promoting its founding user to Client Admin.
 *
 * Used by:
 *   - Stripe webhook (checkout.session.completed) — activationSource: 'STRIPE_WEBHOOK'
 *   - System Admin bypass endpoint              — activationSource: 'SYSTEM_ADMIN_BYPASS'
 *
 * Invariant preserved:
 *   Tenant.ownerUserId → User.role = CLIENT_ADMIN
 *                      → UserRole → Client Admin RoleDefinition
 *   Both updated in a single prisma.$transaction. Never derived from
 *   request body, logged-in user, or Stripe customer data.
 *
 * Idempotency:
 *   - If stripeSubscriptionId is non-null and a Subscription with that ID exists → no-op
 *   - If stripeCheckoutSessionId is non-null and a Subscription with that session ID exists → no-op
 *
 * Amount resolution:
 *   Resolved internally from PricingPlan — never accepted from caller to
 *   ensure the DB is the single source of truth for all pricing.
 */
export async function activateTenantSubscription(
  input: ActivateTenantSubscriptionInput,
): Promise<void> {
  const {
    tenantId,
    planId,
    billingCycle,
    periodEnd,
    stripeSubscriptionId,
    stripeCheckoutSessionId,
    activationSource,
    actorId,
  } = input;

  // ── Idempotency guard 1: Stripe Subscription ID ──────────────────────────
  if (stripeSubscriptionId) {
    const existing = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId },
    });
    if (existing) return;
  }

  // ── Idempotency guard 2: Stripe Checkout Session ID ──────────────────────
  if (stripeCheckoutSessionId) {
    const existing = await prisma.subscription.findFirst({
      where: { stripeCheckoutSessionId },
    });
    if (existing) return;
  }

  // ── Resolve plan + amount from DB (PricingPlan is source of truth) ───────
  const plan = await prisma.pricingPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new AppError('Pricing plan not found', 404);

  const amount =
    billingCycle === 'MONTHLY'   ? plan.monthlyPrice   :
    billingCycle === 'QUARTERLY' ? plan.quarterlyPrice  :
                                   plan.annualPrice;

  const now = new Date();

  // ── Atomic transaction ───────────────────────────────────────────────────
  // All mutations run in a single transaction so the DB never ends up in a
  // half-promoted state (e.g. tenant ACTIVE but owner still Restricted User).
  await prisma.$transaction(async (tx) => {
    // 1. Create the Subscription record
    const subscription = await tx.subscription.create({
      data: {
        tenantId,
        planId,
        billingCycle,
        status:                  'ACTIVE',
        amount,
        startDate:               now,
        nextBillingDate:         periodEnd,
        stripeSubscriptionId:    stripeSubscriptionId ?? null,
        stripeCheckoutSessionId: stripeCheckoutSessionId ?? null,
      },
    });

    // 2. Activate tenant: SANDBOX → ACTIVE
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        plan:               plan.planType,
        subscriptionStatus: 'ACTIVE',
        status:             'ACTIVE',
        subscriptionEndsAt: periodEnd,
      },
    });

    // 3. Promote founding user to Client Admin via ownerUserId (invariant)
    //    Re-query inside the transaction to get the most current ownerUserId.
    //    Never derive the owner from request body or Stripe customer data.
    const tenantRecord = await tx.tenant.findUnique({
      where:  { id: tenantId },
      select: { ownerUserId: true },
    });

    if (tenantRecord?.ownerUserId) {
      const ownerId = tenantRecord.ownerUserId;

      // 3a. Update User.role string (drives JWT super-role bypass on next login)
      await tx.user.update({
        where: { id: ownerId },
        data:  { role: Role.CLIENT_ADMIN },
      });

      // 3b. Update UserRole junction (drives live RolePermission lookup)
      const clientAdminDef = await tx.roleDefinition.findFirst({
        where: { tenantId, name: Role.CLIENT_ADMIN },
      });
      if (clientAdminDef) {
        // Remove existing role junction rows (idempotent — handles re-runs)
        await tx.userRole.deleteMany({
          where: { userId: ownerId, tenantId },
        });
        await tx.userRole.create({
          data: { userId: ownerId, roleId: clientAdminDef.id, tenantId },
        });
      }
    }

    // 4. Audit log — activationSource distinguishes Stripe vs bypass in audit trail
    await writeAuditLog({
      tenantId,
      userId:     actorId,
      action:     'subscription.activated',
      entityType: 'Subscription',
      entityId:   subscription.id,
      metadata:   {
        activationSource,
        planType:                plan.planType,
        billingCycle,
        amount,
        stripeSubscriptionId:    stripeSubscriptionId ?? null,
        stripeCheckoutSessionId: stripeCheckoutSessionId ?? null,
        ownerPromoted:           !!(tenantRecord?.ownerUserId),
      },
    });
  });

  // ── Invalidate plan cache AFTER transaction commits ───────────────────────
  // Must run outside the transaction so middleware reflects the new state
  // as soon as possible after the DB write is durable.
  invalidatePlanCache(tenantId);
}
