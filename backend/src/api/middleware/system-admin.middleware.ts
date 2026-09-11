import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { Role } from '../../shared/constants/roles';

/**
 * systemAdminMiddleware
 *
 * Guards all /admin/* routes.
 * Passes only when req.user.role matches 'System Admin' (case-insensitive).
 *
 * We do NOT check tenantId === 'system' here because system admin users
 * are stored in the DB under a real tenantId (leadcrm-system-demo).
 * Role is the authoritative guard — 'System Admin' is never assigned
 * to regular tenant users.
 */
export function systemAdminMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  if (req.user.role?.toLowerCase() !== Role.SYSTEM_ADMIN.toLowerCase()) {
    // Return 404 to avoid leaking the existence of admin routes
    return next(new AppError('Not found', 404));
  }

  next();
}
