import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPlans, updatePlanById, attachStripePriceToPlan } from './pricing-plans.service';

// ── Schemas ───────────────────────────────────────────────────────────────────

const PaymentMethodSchema = z.object({
  id:          z.string().min(1).max(50),
  name:        z.string().min(1).max(100),
  description: z.string().max(300),
  enabled:     z.boolean(),
});

const UpdatePlanSchema = z.object({
  name:           z.string().min(1).max(100).optional(),
  monthlyPrice:   z.number().nonnegative().optional(),
  features:       z
    .array(
      z.object({
        name:    z.string().min(1).max(200),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  paymentMethods: z.array(PaymentMethodSchema).optional(),
});

const AttachStripePriceSchema = z.object({
  billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
  priceId:      z.string().min(1).startsWith('price_', 'Must be a Stripe Price ID (starts with "price_")'),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /api/v1/admin/plans */
export async function listPlans(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const plans = await getPlans();
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/v1/admin/plans/:id */
export async function updatePlan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = UpdatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code:    'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid request body',
          details: parsed.error.errors.map((e) => ({
            field:  e.path.join('.'),
            reason: e.message,
          })),
        },
      });
      return;
    }

    const planId  = String(req.params.id);
    const updated = await updatePlanById(planId, parsed.data);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/admin/plans/:id/stripe-price
 *
 * Attach an existing Stripe Price (created in the Stripe Dashboard) to a plan
 * for a given billing cycle. The backend verifies the price against Stripe and
 * derives the product id from it — the caller only supplies the price id.
 */
export async function attachStripePrice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = AttachStripePriceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code:    'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid request body',
          details: parsed.error.errors.map((e) => ({
            field:  e.path.join('.'),
            reason: e.message,
          })),
        },
      });
      return;
    }

    const planId  = String(req.params.id);
    const actorId = req.user?.userId;
    const result  = await attachStripePriceToPlan(
      planId,
      parsed.data.billingCycle,
      parsed.data.priceId,
      actorId,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
