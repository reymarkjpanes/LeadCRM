import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/errors/app-error';
import type { PermissionKey } from '../../shared/constants/permissions';
import { assertPermissions } from '../../core/permissions/permission.service';

/** Permission flags come only from active, tenant-scoped RBAC assignments. */
export function authorize(permission: PermissionKey) {
  return authorizeAll(permission);
}

export function authorizeAll(...permissions: PermissionKey[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    try {
      await assertPermissions(req.user, permissions);
      next();
    } catch (err) { next(err); }
  };
}

/** Alternative access is only used for shared pickers, never mutation aliases. */
export function authorizeAny(...permissions: PermissionKey[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    try {
      for (const permission of permissions) {
        try { await assertPermissions(req.user, [permission]); next(); return; }
        catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
      }
      next(new AppError('Access denied', 403));
    } catch (error) { next(error); }
  };
}

/** Archived lists require recovery access even when requested through a source module. */
export const authorizeArchivedQuery = (req: Request, res: Response, next: NextFunction) => {
  if (req.query.archived === 'true' || req.query.isArchived === 'true') return authorize('archived_data.view')(req, res, next);
  next();
};
