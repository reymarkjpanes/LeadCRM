import { Request, Response, NextFunction } from 'express';
import { getTenantPlanData } from '../../shared/utils/plan-cache';
import { Role } from '../../shared/constants/roles';

// ─── Whitelisted Paths ────────────────────────────────────────────────────────
// These paths are always accessible regardless of subscription status.
// Tenant must be able to fix billing and manage their session.

const WHITELISTED_PATH_PREFIXES = [
  '/api/v1/billing',
  '/api/v1/auth',
  '/api/v1/preferences',
  '/api/v1/notifications',
];

// HTTP methods considered "read-only" (not mutations)
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Statuses that allow full access
// NOTE: 'TRIAL' is intentionally excluded — LeadCRM has no trial period.
// New tenants start as NONE (sandbox). Production access requires ACTIVE.
const FULL_ACCESS_STATUSES = new Set(['ACTIVE']);

// Statuses that allow reads but block writes (grace period)
const READ_ONLY_WRITES_STATUSES = new Set(['PAST_DUE']);

// ─── subscriptionGate Middleware ──────────────────────────────────────────────

/**
 * subscriptionGate — Restricts CRM API access based on tenant subscription status.
 *
 * Access policy:
 *   ACTIVE             → Full access
 *   NONE + SANDBOX     → Sandbox Free plan: mutations pass through to recordLimitGate
 *                        and planGate which enforce 100-contact / 3-user limits and
 *                        block premium features (automation, campaigns).
 *   NONE (non-SANDBOX) → Read-only (GET passes; mutations blocked with 403)
 *   PAST_DUE           → Reads pass; mutations blocked with 402
 *   CANCELLED / EXPIRED → Reads pass; mutations blocked with 402
 *
 * System Admin (role === 'System Admin') bypasses this gate entirely.
 * Whitelisted paths always pass (billing, auth, preferences).
 *
 * Placement: authMiddleware → tenantMiddleware → subscriptionGate → authorize → planGate/recordLimitGate → controller
 */
export function subscriptionGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip if no authenticated user
  if (!req.user?.tenantId) return next();

  // System Admin bypasses subscription gate — platform operator, not a customer
  if (req.user.role === Role.SYSTEM_ADMIN) return next();

  // Whitelisted paths always pass
  const requestPath = req.originalUrl || req.path;
  const isWhitelisted = WHITELISTED_PATH_PREFIXES.some((prefix) =>
    requestPath.startsWith(prefix),
  );
  if (isWhitelisted) return next();

  checkSubscriptionAccess(req, res, next);
}

async function checkSubscriptionAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const planData = await getTenantPlanData(req.user!.tenantId);
    const status = planData.subscriptionStatus;

    // Full access — active paid subscription
    if (FULL_ACCESS_STATUSES.has(status)) return next();

    // Read-only methods always pass regardless of subscription state
    const isReadMethod = READ_METHODS.has(req.method.toUpperCase());
    if (isReadMethod) return next();

    // NONE + SANDBOX — Free sandbox plan.
    // Mutations are allowed but subject to recordLimitGate (100 contacts, 3 users)
    // and planGate (automation requires PRO, campaigns require ENTERPRISE).
    if ((status === 'NONE' || !status) && planData.tenantStatus === 'SANDBOX') {
      return next();
    }

    // NONE without SANDBOX status — fully unsubscribed, read-only.
    if (status === 'NONE' || !status) {
      res.status(403).json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: "You're exploring LeadCRM Sandbox. Choose a plan to unlock full CRM access.",
          subscriptionStatus: status ?? 'NONE',
          billingUrl: '/billing/client',
        },
      });
      return;
    }

    // PAST_DUE — grace period: reads pass (handled above), mutations blocked
    if (READ_ONLY_WRITES_STATUSES.has(status)) {
      res.status(402).json({
        success: false,
        error: {
          code: 'PAYMENT_REQUIRED',
          message: 'Your subscription payment has failed. Please update your payment method to continue creating and editing records.',
          subscriptionStatus: status,
          billingUrl: '/billing/client',
        },
      });
      return;
    }

    // CANCELLED / EXPIRED and any other non-ACTIVE state — block mutations
    res.status(402).json({
      success: false,
      error: {
        code: 'PAYMENT_REQUIRED',
        message: 'Your subscription has ended. Please resubscribe to continue using LeadCRM.',
        subscriptionStatus: status,
        billingUrl: '/billing/client',
      },
    });
  } catch {
    // On cache/DB errors, fail open — don't block the user
    next();
  }
}
