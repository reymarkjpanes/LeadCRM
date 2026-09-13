import type Stripe from 'stripe';
import { AppError } from '../../shared/errors/app-error';
import { getStripe } from '../../config/stripe.config';
import { writeAuditLog } from '../../core/audit/audit.service';
import {
  findAllPlans,
  findPlanById,
  updatePlan,
  updateStripeIds,
  type PricingPlanWithFeatures,
  type UpdatePlanInput,
  type UpdateStripeIdsInput,
  type PaymentMethodInput,
} from './pricing-plans.repository';

// Sentinel identifiers for audit entries on the global (non-tenant) PricingPlan.
// PricingPlan is a system-owned model, so there is no tenant to attribute.
const SYSTEM_TENANT_SENTINEL = 'system';
const SYSTEM_ACTOR_SENTINEL  = 'system_admin';

// ── Response shapes ───────────────────────────────────────────────────────────

export interface PlanFeatureDto {
  id:      string;
  name:    string;
  enabled: boolean;
}

export interface PlanPaymentMethodDto {
  id:          string;
  name:        string;
  description: string;
  enabled:     boolean;
}

export interface PricingPlanDto {
  id:             string;
  name:           string;
  planType:       string;
  monthlyPrice:   number;
  quarterlyPrice: number;
  annualPrice:    number;
  maxUsers:       number | null;
  storageLimit:   number | null;
  isActive:       boolean;
  features:       PlanFeatureDto[];
  paymentMethods: PlanPaymentMethodDto[];
  // -- Stripe linkage (null until an existing product/price is attached) --------
  stripeProductId:        string | null;
  stripeMonthlyPriceId:   string | null;
  stripeQuarterlyPriceId: string | null;
  stripeAnnualPriceId:    string | null;
}

export type AttachBillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface AttachStripePriceResult {
  plan:            PricingPlanDto;
  billingCycle:    AttachBillingCycle;
  priceId:         string;
  productId:       string;
  /** Non-blocking warnings — e.g. Stripe price currency/amount differs from the plan's advertised price. */
  warnings:        string[];
}

// ── Default payment methods ───────────────────────────────────────────────────
// Duplicated from shared/src/types/billing.types.ts so the backend has no
// dependency on frontend-shared code.

const DEFAULT_PAYMENT_METHODS: Omit<PlanPaymentMethodDto, 'enabled'>[] = [
  { id: 'card',          name: 'Credit / Debit Cards', description: 'Accept major credit and debit cards.' },
  { id: 'gcash',         name: 'GCash',                description: 'Allow customers to pay using GCash.' },
  { id: 'apple_pay',     name: 'Apple Pay',            description: 'Offer a seamless Apple Pay experience.' },
  { id: 'google_pay',    name: 'Google Pay',           description: 'Let customers pay with Google Pay.' },
  { id: 'bank_transfer', name: 'Bank Transfer',        description: 'Accept direct bank transfers.' },
];

/**
 * Merge the stored paymentMethods JSON value (from PricingPlan.paymentMethods)
 * with DEFAULT_PAYMENT_METHODS so that:
 *  - Saved `enabled` values are preserved per plan.
 *  - New default IDs not yet in the stored list appear with enabled:false.
 *  - IDs present in storage but removed from defaults are dropped gracefully.
 */
function resolvePaymentMethods(raw: unknown): PlanPaymentMethodDto[] {
  let stored: PaymentMethodInput[] = [];
  if (Array.isArray(raw)) {
    stored = raw as PaymentMethodInput[];
  }

  const storedMap = new Map<string, PaymentMethodInput>(
    stored.map((m) => [m.id, m]),
  );

  return DEFAULT_PAYMENT_METHODS.map((def) => {
    const saved = storedMap.get(def.id);
    return {
      id:          def.id,
      name:        saved?.name        ?? def.name,
      description: saved?.description ?? def.description,
      enabled:     saved?.enabled     ?? false,
    };
  });
}

// ── DTO mapper ────────────────────────────────────────────────────────────────
// PricingPlan.paymentMethods is typed as Prisma.JsonValue by the generated
// client — we pass it directly to resolvePaymentMethods which accepts `unknown`.

function toDto(plan: PricingPlanWithFeatures): PricingPlanDto {
  return {
    id:             plan.id,
    name:           plan.name,
    planType:       plan.planType,
    monthlyPrice:   plan.monthlyPrice,
    quarterlyPrice: plan.quarterlyPrice,
    annualPrice:    plan.annualPrice,
    maxUsers:       plan.maxUsers ?? null,
    storageLimit:   plan.storageLimit ?? null,
    isActive:       plan.isActive,
    features:       plan.features.map((f) => ({
      id:      f.id,
      name:    f.name,
      enabled: f.isEnabled,
    })),
    paymentMethods: resolvePaymentMethods(plan.paymentMethods),
    stripeProductId:        plan.stripeProductId        ?? null,
    stripeMonthlyPriceId:   plan.stripeMonthlyPriceId   ?? null,
    stripeQuarterlyPriceId: plan.stripeQuarterlyPriceId ?? null,
    stripeAnnualPriceId:    plan.stripeAnnualPriceId    ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<PricingPlanDto[]> {
  const plans = await findAllPlans();
  // paymentMethods is included in the Prisma response as Prisma.JsonValue
  return plans.map(toDto);
}

export async function updatePlanById(
  id: string,
  input: UpdatePlanInput,
): Promise<PricingPlanDto> {
  const existing = await findPlanById(id);
  if (!existing) throw new AppError('Pricing plan not found', 404);

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new AppError('Plan name cannot be empty', 400);
    if (trimmed.length > 100) throw new AppError('Plan name must be 100 characters or fewer', 400);
  }

  if (input.monthlyPrice !== undefined && input.monthlyPrice < 0) {
    throw new AppError('Monthly price cannot be negative', 400);
  }

  const updated = await updatePlan(id, input);
  return toDto(updated);
}

// ── Attach existing Stripe product/price ───────────────────────────────────────

/**
 * Map a billing cycle to the plan field holding its advertised price
 * and the Stripe recurring interval that a valid price must match.
 */
const CYCLE_CONFIG: Record<
  AttachBillingCycle,
  {
    priceField:     keyof UpdateStripeIdsInput;
    planPriceField: 'monthlyPrice' | 'quarterlyPrice' | 'annualPrice';
    interval:       Stripe.Price.Recurring.Interval;
    intervalCount:  number;
    label:          string;
  }
> = {
  MONTHLY:   { priceField: 'stripeMonthlyPriceId',   planPriceField: 'monthlyPrice',   interval: 'month', intervalCount: 1, label: 'monthly'   },
  QUARTERLY: { priceField: 'stripeQuarterlyPriceId', planPriceField: 'quarterlyPrice', interval: 'month', intervalCount: 3, label: 'quarterly' },
  ANNUAL:    { priceField: 'stripeAnnualPriceId',    planPriceField: 'annualPrice',    interval: 'year',  intervalCount: 1, label: 'annual'    },
};

/**
 * Attach an EXISTING Stripe Price (and its parent Product) to a pricing plan for
 * a given billing cycle. This is the reusable path for linking a plan to a
 * product that was created directly in the Stripe Dashboard.
 *
 * Unlike syncPlanToStripe(), this does NOT create anything in Stripe — it verifies
 * the provided price against the Stripe API and stores its IDs on the plan.
 *
 * Verification:
 *  - price exists and is active
 *  - price is recurring with an interval matching the billing cycle
 *  - product id is derived from the price (never trusted from the caller)
 *
 * Non-blocking warnings are returned (not thrown) when the Stripe price's
 * currency or amount differs from the plan's advertised price so the admin can
 * reconcile the discrepancy without being blocked.
 *
 * @param actorId  The authenticated system admin id, for audit attribution.
 */
export async function attachStripePriceToPlan(
  planId: string,
  billingCycle: AttachBillingCycle,
  priceId: string,
  actorId?: string,
): Promise<AttachStripePriceResult> {
  const plan = await findPlanById(planId);
  if (!plan) throw new AppError('Pricing plan not found', 404);

  const config = CYCLE_CONFIG[billingCycle];
  const stripe = getStripe();

  // Retrieve the price from Stripe with its product expanded so we can derive
  // (and validate) the product id rather than trusting a hand-entered value.
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  } catch {
    throw new AppError(`Stripe price "${priceId}" was not found in this Stripe account/mode`, 404);
  }

  // ── Validate the price is usable for a subscription ────────────────────────
  if (!price.active) {
    throw new AppError(`Stripe price "${priceId}" is archived/inactive and cannot be used for checkout`, 400);
  }

  if (price.type !== 'recurring' || !price.recurring) {
    throw new AppError(`Stripe price "${priceId}" is not a recurring price — subscriptions require a recurring price`, 400);
  }

  if (
    price.recurring.interval !== config.interval ||
    (price.recurring.interval_count ?? 1) !== config.intervalCount
  ) {
    const expected = config.intervalCount === 1
      ? `1 ${config.interval}`
      : `${config.intervalCount} ${config.interval}s`;
    const actual = (price.recurring.interval_count ?? 1) === 1
      ? `1 ${price.recurring.interval}`
      : `${price.recurring.interval_count} ${price.recurring.interval}s`;
    throw new AppError(
      `Stripe price interval (${actual}) does not match the ${config.label} billing cycle (expected ${expected})`,
      400,
    );
  }

  // ── Derive the product id from the price (never trust caller input) ─────────
  const productId = typeof price.product === 'string'
    ? price.product
    : price.product.id;

  if (!productId) {
    throw new AppError(`Stripe price "${priceId}" has no associated product`, 400);
  }

  // ── Non-blocking reconciliation warnings ───────────────────────────────────
  const warnings: string[] = [];

  // Plan prices are stored in major currency units; Stripe uses minor units.
  const advertisedPrice   = plan[config.planPriceField];
  const expectedMinorUnit = Math.round(advertisedPrice * 100);
  if (price.unit_amount !== null && price.unit_amount !== expectedMinorUnit) {
    warnings.push(
      `Stripe price amount (${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}) ` +
      `differs from the plan's advertised ${config.label} price (${advertisedPrice.toFixed(2)}). ` +
      `Customers will be charged the Stripe amount.`,
    );
  }

  // ── Persist the product + cycle-specific price id ──────────────────────────
  const stripeUpdate: UpdateStripeIdsInput = {
    stripeProductId:      productId,
    [config.priceField]:  priceId,
  };
  const updated = await updateStripeIds(planId, stripeUpdate);

  // ── Audit (fire-and-forget; never blocks the operation) ────────────────────
  void writeAuditLog({
    tenantId:   SYSTEM_TENANT_SENTINEL,
    userId:     actorId ?? SYSTEM_ACTOR_SENTINEL,
    action:     'plan.stripe_price_attached',
    entityType: 'PricingPlan',
    entityId:   planId,
    metadata:   { billingCycle, priceId, productId, currency: price.currency, unitAmount: price.unit_amount },
    severity:   warnings.length > 0 ? 'WARNING' : 'INFO',
  });

  return {
    plan:         toDto(updated),
    billingCycle,
    priceId,
    productId,
    warnings,
  };
}
