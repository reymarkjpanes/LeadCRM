import { Request, Response, NextFunction } from 'express';
import { isOnboardingComplete } from '@leadcrm/shared';
import { AppError } from '../../shared/errors/app-error';

/**
 * Ensures every request beyond this point has a valid tenantId.
 * tenantId is always taken from the JWT — never from the request body.
 */
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.tenantId) {
    throw new AppError('Tenant context required', 403);
  }
  next();
}

/** Applied to CRM routes after authentication; platform operators use their own portal. */
export function workspaceReadyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const user = req.authUser;
  if (!user) return next(new AppError('Authentication required', 401));
  if (user.mustChangePassword) return next(new AppError('Change your password first.', 403, 'PASSWORD_CHANGE_REQUIRED'));
  if (user.role === 'Client Admin' && !isOnboardingComplete(user)) {
    return next(new AppError('Complete workspace setup first.', 403, 'ONBOARDING_REQUIRED'));
  }
  next();
}
