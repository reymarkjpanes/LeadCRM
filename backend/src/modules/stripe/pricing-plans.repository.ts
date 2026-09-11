import prisma from '../../config/database.config';
import type { PlanFeature, PricingPlan } from '@prisma/client';
import { Prisma } from '@prisma/client';

export type PricingPlanWithFeatures = PricingPlan & { features: PlanFeature[] };

// ── Read ──────────────────────────────────────────────────────────────────────

export async function findAllPlans(): Promise<PricingPlanWithFeatures[]> {
  return prisma.pricingPlan.findMany({
    where:   { isActive: true },
    include: { features: { orderBy: { name: 'asc' } } },
    orderBy: { monthlyPrice: 'asc' },
  });
}

export async function findPlanById(id: string): Promise<PricingPlanWithFeatures | null> {
  return prisma.pricingPlan.findUnique({
    where:   { id },
    include: { features: { orderBy: { name: 'asc' } } },
  });
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface PaymentMethodInput {
  id:          string;
  name:        string;
  description: string;
  enabled:     boolean;
}

export interface UpdatePlanInput {
  name?:           string;
  monthlyPrice?:   number;
  /** Full replacement of the feature list — array of { name, enabled } */
  features?:       Array<{ name: string; enabled: boolean }>;
  /** Full replacement of payment method config — stored as JSON on the plan row */
  paymentMethods?: PaymentMethodInput[];
}

export interface UpdateStripeIdsInput {
  stripeProductId?:        string;
  stripeMonthlyPriceId?:   string;
  stripeQuarterlyPriceId?: string;
  stripeAnnualPriceId?:    string;
}

/**
 * Persist Stripe product / price IDs onto a plan row.
 * Only the provided fields are written; undefined fields are left untouched.
 * Used by the "attach existing Stripe product/price" admin flow — kept separate
 * from updatePlan() because Stripe IDs are set through Stripe-verified attach,
 * never through the general plan editor payload.
 */
export async function updateStripeIds(
  id: string,
  input: UpdateStripeIdsInput,
): Promise<PricingPlanWithFeatures> {
  const data: Prisma.PricingPlanUpdateInput = {};
  if (input.stripeProductId        !== undefined) data.stripeProductId        = input.stripeProductId;
  if (input.stripeMonthlyPriceId   !== undefined) data.stripeMonthlyPriceId   = input.stripeMonthlyPriceId;
  if (input.stripeQuarterlyPriceId !== undefined) data.stripeQuarterlyPriceId = input.stripeQuarterlyPriceId;
  if (input.stripeAnnualPriceId    !== undefined) data.stripeAnnualPriceId    = input.stripeAnnualPriceId;

  return prisma.pricingPlan.update({
    where:   { id },
    data,
    include: { features: { orderBy: { name: 'asc' } } },
  });
}

export async function updatePlan(
  id: string,
  input: UpdatePlanInput,
): Promise<PricingPlanWithFeatures> {
  return prisma.$transaction(async (tx) => {
    // 1. Update scalar and JSON fields on the plan row via the typed Prisma client.
    //    paymentMethods is a Json column — Prisma accepts InputJsonValue for it.
    const planData: Prisma.PricingPlanUpdateInput = {};

    if (input.name           !== undefined) planData.name           = input.name;
    if (input.monthlyPrice   !== undefined) planData.monthlyPrice   = input.monthlyPrice;
    if (input.paymentMethods !== undefined) {
      // Cast to InputJsonValue as required by Prisma for Json fields
      planData.paymentMethods = input.paymentMethods as unknown as Prisma.InputJsonValue;
    }

    if (Object.keys(planData).length > 0) {
      await tx.pricingPlan.update({ where: { id }, data: planData });
    }

    // 2. Replace feature list when provided (full replacement, not a patch)
    if (input.features !== undefined) {
      await tx.planFeature.deleteMany({ where: { planId: id } });

      const validFeatures = input.features.filter((f) => f.name.trim() !== '');
      if (validFeatures.length > 0) {
        await tx.planFeature.createMany({
          data: validFeatures.map((f) => ({
            planId:    id,
            name:      f.name.trim(),
            isEnabled: f.enabled,
          })),
        });
      }
    }

    // 3. Return the updated plan with features — paymentMethods included by
    //    the generated Prisma client as Prisma.JsonValue
    const updated = await tx.pricingPlan.findUnique({
      where:   { id },
      include: { features: { orderBy: { name: 'asc' } } },
    });

    if (!updated) throw new Error('Plan not found after update');
    return updated;
  });
}
