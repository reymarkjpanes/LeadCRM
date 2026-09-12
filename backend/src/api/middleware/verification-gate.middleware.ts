/**
 * verification-gate.middleware.ts
 *
 * Blocks Stripe checkout for SANDBOX tenants that have not been
 * verified by an admin.
 *
 * Only applies to SANDBOX tenants (new guests before their first subscription).
 * Existing ACTIVE subscribers bypass this gate — they're already verified.
 *
 * Placement in middleware chain:
 *   authMiddleware → tenantMiddleware → authorize('billing.manage')
 *   → billingMutationRateLimiter → verificationGate → controller
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database.config';

export async function verificationGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // If no authenticated user, skip (authMiddleware will have already rejected)
  if (!req.user?.tenantId) {
    next();
    return;
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { status: true, verificationStatus: true },
    });

    if (!tenant) {
      next();
      return;
    }

    // Only gate SANDBOX tenants. ACTIVE tenants are already subscribers — skip.
    if (tenant.status !== 'SANDBOX') {
      next();
      return;
    }

    // APPROVED — allow checkout
    if (tenant.verificationStatus === 'APPROVED') {
      next();
      return;
    }

    // All other statuses (NOT_SUBMITTED, PENDING, REJECTED, REQUIRES_RESUBMISSION)
    // block checkout and redirect the frontend to the verification flow.
    res.status(403).json({
      success: false,
      error: {
        code: 'VERIFICATION_REQUIRED',
        verificationStatus: tenant.verificationStatus ?? 'NOT_SUBMITTED',
        message:
          'Business verification is required before subscribing. Please submit your business documents for review.',
        billingUrl: '/billing/client',
      },
    });
  } catch {
    // On DB error, fail open — do not block the user due to infrastructure issues
    next();
  }
}
