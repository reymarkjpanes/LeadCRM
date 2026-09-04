import Stripe from 'stripe';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '../../config/stripe.config';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { writeAuditLog } from '../../core/audit/audit.service';
import { invalidatePlanCache } from '../../shared/utils/plan-cache';

// ─── Signature Verification ───────────────────────────────────────────────────

/**
 * Verify and construct a Stripe event from a raw webhook payload.
 * Throws AppError 400 if the signature is invalid or the secret is missing.
 * MUST be called with the raw (unparsed) request body buffer.
 */
export function constructStripeEvent(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): Stripe.Event {
  const stripe = getStripe();
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new AppError('Stripe webhook secret is not configured', 500);
  }

  if (!signatureHeader) {
    throw new AppError('Missing Stripe-Signature header', 400);
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new AppError(
      `Webhook signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      400,
    );
  }
}

// ─── Event Router ─────────────────────────────────────────────────────────────

/**
 * Route a verified Stripe event to the appropriate handler.
 * All handlers are idempotent — safe to call multiple times for the same event.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id);
      break;

    case 'charge.refunded':
      await handleChargeRefunded(event.data.object as Stripe.Charge, event.id);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, event.id);
      break;

    // Deliberately unhandled — log and ignore gracefully
    default:
      if (process.env.NODE_ENV !== 'production') {
        console.info(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      }
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * checkout.session.completed
 *
 * Fired when a customer completes Stripe Checkout.
 * This is the authoritative signal to activate a subscription.
 * Never activate a subscription from a frontend success redirect.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription') return;

  const { tenantId, planId, billingCycle } = session.metadata ?? {};
  if (!tenantId || !planId || !billingCycle) {
    console.error('[Stripe Webhook] checkout.session.completed missing metadata', session.id);
    return;
  }

  const stripeSubscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!stripeSubscriptionId) {
    console.error('[Stripe Webhook] checkout.session.completed missing subscription ID', session.id);
    return;
  }

  // Idempotency: check if already processed
  const existingSub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId },
  });
  if (existingSub) return;

  // Resolve billing cycle enum
  const bc = (billingCycle as string).toUpperCase() as 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  const plan = await prisma.pricingPlan.findUnique({ where: { id: planId } });
  if (!plan) {
    console.error('[Stripe Webhook] Plan not found for checkout.session.completed', planId);
    return;
  }

  const amount =
    bc === 'MONTHLY'   ? plan.monthlyPrice   :
    bc === 'QUARTERLY' ? plan.quarterlyPrice  :
                         plan.annualPrice;

  const now = new Date();

  // Retrieve subscription from Stripe to get period dates
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const periodEnd = new Date((stripeSub.current_period_end ?? 0) * 1000);

  await prisma.$transaction(async (tx) => {
    // Create the Subscription record
    const subscription = await tx.subscription.create({
      data: {
        tenantId,
        planId,
        billingCycle:           bc,
        status:                 'ACTIVE',
        amount,
        startDate:              now,
        nextBillingDate:        periodEnd,
        stripeSubscriptionId,
        stripeCheckoutSessionId: session.id,
      },
    });

    // Update tenant's denormalized plan cache
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        plan:               plan.planType,
        subscriptionStatus: 'ACTIVE',
        status:             'ACTIVE', // promote SANDBOX tenant to ACTIVE on first successful payment
        subscriptionEndsAt: periodEnd,
      },
    });

    await writeAuditLog({
      tenantId,
      userId:     'stripe_webhook',
      action:     'stripe.subscription.activated',
      entityType: 'Subscription',
      entityId:   subscription.id,
      metadata:   { stripeSubscriptionId, checkoutSessionId: session.id },
    });
  });

  // Invalidate plan cache so middleware reflects new subscription immediately
  invalidatePlanCache(tenantId);
}

/**
 * invoice.payment_succeeded
 *
 * Fired for every successful recurring subscription invoice.
 * Creates a PaymentTransaction and updates Invoice paymentStatus.
 */
async function handleInvoicePaymentSucceeded(stripeInvoice: Stripe.Invoice): Promise<void> {
  // Idempotency: skip if we already recorded this Stripe invoice
  const existing = await prisma.paymentTransaction.findFirst({
    where: { stripeInvoiceId: stripeInvoice.id },
  });
  if (existing) return;

  const stripeSubscriptionId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription
    : stripeInvoice.subscription?.id ?? null;

  if (!stripeSubscriptionId) return; // one-time charge, not subscription

  const subscription = await prisma.subscription.findFirst({
    where:   { stripeSubscriptionId },
    include: { tenant: true },
  });

  if (!subscription) {
    console.warn('[Stripe Webhook] invoice.payment_succeeded — no local subscription for', stripeSubscriptionId);
    return;
  }

  const tenantId = subscription.tenantId;

  // Find or create a matching Invoice record
  let invoice = await prisma.invoice.findFirst({
    where: { subscriptionId: subscription.id, paymentStatus: 'Unpaid' },
  });

  const amountPaid  = (stripeInvoice.amount_paid ?? 0) / 100;
  const periodEnd   = new Date((stripeInvoice.period_end ?? 0) * 1000);
  const paymentIntent = typeof stripeInvoice.payment_intent === 'string'
    ? stripeInvoice.payment_intent
    : stripeInvoice.payment_intent?.id ?? null;

  if (!invoice) {
    // Auto-create invoice for renewal payments
    invoice = await prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        invoiceNumber:  `STRIPE-${stripeInvoice.number ?? stripeInvoice.id}`,
        plan:           subscription.planId,
        amount:         amountPaid,
        taxAmount:      0,
        discountAmount: 0,
        totalAmount:    amountPaid,
        currency:       stripeInvoice.currency?.toUpperCase() ?? 'USD',
        frequency:      subscription.billingCycle === 'MONTHLY' ? 'Monthly' :
                        subscription.billingCycle === 'QUARTERLY' ? 'Quarterly' : 'Annual',
        status:         'Active',
        paymentStatus:  'Paid',
        startDate:      new Date((stripeInvoice.period_start ?? 0) * 1000),
        dueDate:        periodEnd,
        paidAt:         new Date(),
      },
    });
  }

  await prisma.$transaction([
    prisma.paymentTransaction.create({
      data: {
        tenantId,
        invoiceId:              invoice.id,
        amount:                 amountPaid,
        currency:               stripeInvoice.currency?.toUpperCase() ?? 'USD',
        status:                 'paid',
        paymentMethod:          'stripe',
        stripePaymentIntentId:  paymentIntent,
        stripeInvoiceId:        stripeInvoice.id,
        paidAt:                 new Date(),
        metadata:               { stripeInvoiceId: stripeInvoice.id } as object,
      },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data:  { paymentStatus: 'Paid', paidAt: new Date(), status: 'Active' },
    }),
    // Keep next billing date current on the subscription
    prisma.subscription.update({
      where: { id: subscription.id },
      data:  {
        status:         'ACTIVE',
        nextBillingDate: periodEnd,
      },
    }),
  ]);

  await writeAuditLog({
    tenantId,
    userId:     'stripe_webhook',
    action:     'stripe.invoice.payment_succeeded',
    entityType: 'Invoice',
    entityId:   invoice.id,
    metadata:   { stripeInvoiceId: stripeInvoice.id, amount: amountPaid },
  });
}

/**
 * invoice.payment_failed
 *
 * Fired when Stripe cannot collect payment for a recurring invoice.
 * Marks subscription as PAST_DUE — does not cancel or activate.
 */
async function handleInvoicePaymentFailed(stripeInvoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription
    : stripeInvoice.subscription?.id ?? null;

  if (!stripeSubscriptionId) return;

  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId },
  });
  if (!subscription) return;

  const paymentIntent = typeof stripeInvoice.payment_intent === 'string'
    ? stripeInvoice.payment_intent
    : stripeInvoice.payment_intent?.id ?? null;

  // Idempotency check
  if (paymentIntent) {
    const existing = await prisma.paymentTransaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent, status: 'failed' },
    });
    if (existing) return;
  }

  const amountDue = (stripeInvoice.amount_due ?? 0) / 100;

  // Find unpaid invoice or create one to record the failure against
  let invoice = await prisma.invoice.findFirst({
    where: { subscriptionId: subscription.id, paymentStatus: 'Unpaid' },
  });

  if (!invoice) {
    invoice = await prisma.invoice.create({
      data: {
        tenantId:       subscription.tenantId,
        subscriptionId: subscription.id,
        invoiceNumber:  `STRIPE-FAIL-${stripeInvoice.id}`,
        plan:           subscription.planId,
        amount:         amountDue,
        taxAmount:      0,
        discountAmount: 0,
        totalAmount:    amountDue,
        currency:       stripeInvoice.currency?.toUpperCase() ?? 'USD',
        frequency:      'Monthly',
        status:         'Expired',
        paymentStatus:  'Overdue',
        startDate:      new Date(),
        dueDate:        new Date(),
      },
    });
  }

  await prisma.$transaction([
    prisma.paymentTransaction.create({
      data: {
        tenantId:              subscription.tenantId,
        invoiceId:             invoice.id,
        amount:                amountDue,
        currency:              stripeInvoice.currency?.toUpperCase() ?? 'USD',
        status:                'failed',
        paymentMethod:         'stripe',
        stripePaymentIntentId: paymentIntent,
        stripeInvoiceId:       stripeInvoice.id,
        failureReason:         'Stripe invoice payment failed',
        metadata:              { stripeInvoiceId: stripeInvoice.id } as object,
      },
    }),
    prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: 'PAST_DUE' },
    }),
    prisma.tenant.update({
      where: { id: subscription.tenantId },
      data:  { subscriptionStatus: 'PAST_DUE' },
    }),
  ]);

  await writeAuditLog({
    tenantId:   subscription.tenantId,
    userId:     'stripe_webhook',
    action:     'stripe.invoice.payment_failed',
    entityType: 'Subscription',
    entityId:   subscription.id,
    metadata:   { stripeInvoiceId: stripeInvoice.id, amountDue },
    severity:   'WARNING',
  });

  // Invalidate plan cache so subscription gate reflects PAST_DUE immediately
  invalidatePlanCache(subscription.tenantId);
}

/**
 * customer.subscription.created | customer.subscription.updated
 *
 * Keeps our DB subscription status in sync with Stripe.
 */
async function handleSubscriptionUpdated(
  stripeSub: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSub.id },
  });
  if (!subscription) return;

  const statusMap: Record<string, string> = {
    active:            'ACTIVE',
    trialing:          'TRIAL',
    past_due:          'PAST_DUE',
    canceled:          'CANCELLED',
    incomplete:        'PAST_DUE',
    incomplete_expired: 'EXPIRED',
    paused:            'PAST_DUE',
    unpaid:            'PAST_DUE',
  };

  const newStatus = statusMap[stripeSub.status] ?? 'PAST_DUE';
  const periodEnd = new Date(stripeSub.current_period_end * 1000);

  // Detect if there's a pending plan change that has now taken effect.
  // When Stripe applies the new price (at period end for downgrades),
  // the subscription.updated event fires with the new price/product.
  // If we have a pending downgrade recorded, clear it and apply the new plan.
  const hasPendingDowngrade = !!subscription.pendingPlanId;

  const subscriptionUpdateData: Record<string, unknown> = {
    status: newStatus,
    nextBillingDate: periodEnd,
  };

  const tenantUpdateData: Record<string, unknown> = {
    subscriptionStatus: newStatus,
  };

  if (hasPendingDowngrade) {
    // Pending downgrade has been applied by Stripe — update local records
    subscriptionUpdateData.planId = subscription.pendingPlanId;
    if (subscription.pendingBillingCycle) {
      subscriptionUpdateData.billingCycle = subscription.pendingBillingCycle;
    }
    // Clear pending fields
    subscriptionUpdateData.pendingPlanId = null;
    subscriptionUpdateData.pendingBillingCycle = null;
    subscriptionUpdateData.pendingDowngradeAt = null;

    // Update tenant denormalized plan from the new plan record
    const newPlan = await prisma.pricingPlan.findUnique({
      where: { id: subscription.pendingPlanId! },
      select: { planType: true, maxUsers: true, maxContacts: true, maxDeals: true },
    });
    if (newPlan) {
      tenantUpdateData.plan = newPlan.planType;
      tenantUpdateData.maxUsers = newPlan.maxUsers;
      tenantUpdateData.maxContacts = newPlan.maxContacts;
      tenantUpdateData.maxDeals = newPlan.maxDeals;
    }
  }

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: subscriptionUpdateData as never,
    }),
    prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: tenantUpdateData as never,
    }),
  ]);

  // Invalidate plan cache so middleware reflects new status/plan immediately
  invalidatePlanCache(subscription.tenantId);
}

/**
 * customer.subscription.deleted
 *
 * Stripe has fully cancelled the subscription.
 */
async function handleSubscriptionDeleted(
  stripeSub: Stripe.Subscription,
  _eventId: string,
): Promise<void> {
  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSub.id },
  });
  if (!subscription) return;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: 'CANCELLED', cancelledAt: new Date() },
    }),
    prisma.tenant.update({
      where: { id: subscription.tenantId },
      data:  { subscriptionStatus: 'CANCELLED', plan: 'FREE' },
    }),
  ]);

  await writeAuditLog({
    tenantId:   subscription.tenantId,
    userId:     'stripe_webhook',
    action:     'stripe.subscription.deleted',
    entityType: 'Subscription',
    entityId:   subscription.id,
    severity:   'WARNING',
  });

  // Invalidate plan cache so middleware reflects cancelled status immediately
  invalidatePlanCache(subscription.tenantId);
}

/**
 * charge.refunded
 *
 * Sync refund status from Stripe. Handles cases where refunds are initiated
 * via the Stripe Dashboard rather than through our application.
 */
async function handleChargeRefunded(charge: Stripe.Charge, eventId: string): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null;

  if (!paymentIntentId) return;

  const txn = await prisma.paymentTransaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
  });
  if (!txn) return;

  // Idempotency
  if (txn.stripeEventId === eventId) return;

  const amountRefunded = (charge.amount_refunded ?? 0) / 100;
  const isFullRefund   = charge.refunded === true;
  const latestRefund   = charge.refunds?.data?.[0];

  await prisma.paymentTransaction.update({
    where: { id: txn.id },
    data:  {
      refundedAmount: amountRefunded,
      refundedAt:     new Date(),
      stripeRefundId: latestRefund?.id ?? txn.stripeRefundId,
      stripeEventId:  eventId,
      status:         isFullRefund ? 'refunded' : 'partially_refunded',
    },
  });
}

/**
 * payment_intent.payment_failed
 *
 * Mark the corresponding PaymentTransaction as failed.
 */
async function handlePaymentIntentFailed(
  intent: Stripe.PaymentIntent,
  eventId: string,
): Promise<void> {
  const txn = await prisma.paymentTransaction.findFirst({
    where: { stripePaymentIntentId: intent.id },
  });

  if (!txn) return;
  if (txn.status === 'failed') return; // already recorded

  const declineCode = intent.last_payment_error?.decline_code;
  const safeReason  = declineCode === 'insufficient_funds' ? 'Insufficient funds' :
                      declineCode === 'card_declined'       ? 'Card declined'       :
                      declineCode === 'expired_card'        ? 'Card expired'        :
                      'Payment declined';

  await prisma.paymentTransaction.update({
    where: { id: txn.id },
    data:  {
      status:        'failed',
      failureReason: safeReason,
      stripeEventId: eventId,
    },
  });
}
