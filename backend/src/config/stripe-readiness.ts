import prisma from './database.config';

/**
 * checkStripeReadiness
 *
 * Read-only startup validation. Checks env vars and DB state to give
 * developers an immediate, actionable diagnosis of Stripe configuration.
 *
 * Rules:
 * - No Stripe API calls — never creates products/prices on startup
 * - Non-throwing — any error is caught and logged
 * - Idempotent — safe to call multiple times
 */
export async function checkStripeReadiness(): Promise<void> {
  const warnings: string[] = [];
  let allGood = true;

  // 1. Check STRIPE_SECRET_KEY
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey || secretKey.startsWith('sk_test_your') || secretKey.startsWith('sk_live_your')) {
    warnings.push(
      'STRIPE_SECRET_KEY is not set or is still a placeholder — checkout will fail',
    );
    allGood = false;
  }

  // 2. Check STRIPE_WEBHOOK_SECRET
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!webhookSecret || webhookSecret.startsWith('whsec_your')) {
    warnings.push(
      'STRIPE_WEBHOOK_SECRET is not set or is still a placeholder — ' +
      'webhook signature verification will fail. ' +
      'Run: stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe ' +
      'and copy the printed whsec_... secret into STRIPE_WEBHOOK_SECRET',
    );
    allGood = false;
  }

  // 3. Check PricingPlan Stripe Price IDs (DB-only — no Stripe API call)
  try {
    const plans = await prisma.pricingPlan.findMany({ where: { isActive: true } });

    if (plans.length === 0) {
      warnings.push(
        'No active PricingPlan records found — run: npm --prefix backend run db:seed',
      );
      allGood = false;
    }

    for (const plan of plans) {
      if (!plan.stripeMonthlyPriceId) {
        warnings.push(
          `Plan "${plan.name}" missing stripeMonthlyPriceId — ` +
          'run: POST /api/v1/admin/billing/plans/sync-all',
        );
        allGood = false;
      }
      if (!plan.stripeQuarterlyPriceId) {
        warnings.push(
          `Plan "${plan.name}" missing stripeQuarterlyPriceId — ` +
          'run: POST /api/v1/admin/billing/plans/sync-all',
        );
        allGood = false;
      }
      if (!plan.stripeAnnualPriceId) {
        warnings.push(
          `Plan "${plan.name}" missing stripeAnnualPriceId — ` +
          'run: POST /api/v1/admin/billing/plans/sync-all',
        );
        allGood = false;
      }
    }
  } catch (err) {
    warnings.push(
      `Could not check PricingPlan Stripe IDs: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    allGood = false;
  }

  if (allGood) {
    console.log('[Stripe] ✓ Stripe configuration looks ready — checkout and webhooks should work');
  } else {
    for (const warning of warnings) {
      console.warn(`[Stripe] ⚠ ${warning}`);
    }
  }
}
