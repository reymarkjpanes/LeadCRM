import { requireEmployeeAccount } from '../../core/auth/account-access';
import { isOnboardingComplete } from '@leadcrm/shared';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@leadcrm/shared';
import { readAuthUser } from '../../core/auth/auth-user';
import { appConfig } from '../../config/app.config';
import { AppError } from '../../shared/errors/app-error';
import { validateSession } from '../../core/auth/session.service';
import { tenantContext } from '../../core/tenant/tenant-context';

export interface AuthenticatedUser {
  userId:   string;
  tenantId: string;
  role:     string;
  email:    string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authUser?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Prefer HttpOnly cookie; fall back to Bearer token for API clients
  const cookieToken: string | undefined = req.cookies?.leadcrm_token;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

  const token = cookieToken ?? bearerToken;

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  try {
    // 1. Verify JWT signature and expiry
    const payload = jwt.verify(token, appConfig.jwtSecret) as AuthenticatedUser;

    // 2. Validate against Session store — catches revoked tokens
    //    (deactivated user, forced logout, logout from all devices)
    const session = await validateSession(token);
    if (session.userId !== payload.userId || session.tenantId !== payload.tenantId) {
      throw new AppError('Invalid or expired token', 401);
    }

    const user = await readAuthUser(payload.userId, payload.tenantId);
    if (user.status !== 'ACTIVE') throw new AppError('Account is inactive.', 401);
    requireEmployeeAccount(user);
    const authPath = req.baseUrl?.endsWith('/auth') ? req.path : '';
    const recovery = ['/me', '/change-password', '/logout'].includes(authPath);
    if (['SUSPENDED', 'REJECTED'].includes(user.tenantStatus ?? '')) {
      throw new AppError('Workspace access is suspended.', 403);
    }
    if (user.mustChangePassword && !recovery) {
      throw new AppError('Change your temporary password first.', 403, 'PASSWORD_CHANGE_REQUIRED');
    }
    if (user.role === 'Client Admin' && !isOnboardingComplete(user) && !recovery &&
        !['/onboarding/status', '/onboarding/complete'].includes(authPath)) {
      throw new AppError('Complete the LeadCRM introduction first.', 403, 'ONBOARDING_REQUIRED');
    }
    req.authUser = user;
    req.user = { ...payload, role: user.role, email: user.email };
    tenantContext.run({ tenantId: user.tenantId }, next);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      return next(new AppError('Invalid or expired token', 401));
    }
    // A database outage is a retryable server failure, not proof of a missing session.
    next(err);
  }
}
