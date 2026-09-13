import { Request, Response, NextFunction } from 'express';

import * as service from './preferences.service';
import * as repo from './preferences.repository';
import { isValidModule } from './column-registry';
import { AppError } from '../../shared/errors/app-error';
import { DEFAULT_ROLE_PERMISSIONS } from '../../core/permissions/permission.registry';
import { isSuperRole } from '../../shared/utils/is-super-role';
import type { ColumnSource } from '@leadcrm/shared';

// ─────────────────────────────────────────────────────
// Controller — HTTP handlers only. No business logic here.
// ─────────────────────────────────────────────────────

// Map module IDs to their view permission key
const MODULE_VIEW_PERMISSIONS: Record<string, string> = {
  leads: 'contacts.view',
  contacts: 'contacts.view',
  accounts: 'accounts.view',
  deals: 'deals.view',
};

/** R12 AC2: Check module-level view permission (returns 404 to not reveal existence) */
function hasModuleViewPermission(req: Request, module: string): boolean {
  const role = req.user?.role;
  if (!role) return false;
  if (isSuperRole(role)) return true;
  const requiredPermission = MODULE_VIEW_PERMISSIONS[module];
  if (!requiredPermission) return true;
  const rolePermissions: string[] = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  return rolePermissions.includes(requiredPermission);
}

/**
 * GET /api/v1/preferences/columns/:module
 * Returns effective columns for the authenticated user (User > Tenant > System).
 */
export async function getEffectiveColumns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, userId } = req.user!;
    const module = String(req.params.module);

    if (!isValidModule(module)) {
      throw new AppError('Not found', 404);
    }

    // R12 AC2: Check module-level view permission
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    const { config, source } = await resolveWithSource(tenantId, userId, module);

    res.json({
      success: true,
      data: { module, source, columns: config.columns },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/columns/:module
 * Save user's column preference for the given module.
 */
export async function saveUserPreference(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, userId } = req.user!;
    const module = String(req.params.module);

    if (!isValidModule(module)) {
      throw new AppError('Not found', 404);
    }

    // R17.8: Check module-level view permission (returns 404 to not reveal existence)
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    const config = await service.upsertUserPreference(
      tenantId,
      userId,
      module,
      { module, columns: req.body.columns },
    );

    res.json({
      success: true,
      data: { module, source: 'user' as ColumnSource, columns: config.columns },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/preferences/columns/:module
 * Delete user's column preference, returning the fallback effective columns.
 */
export async function deleteUserPreference(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, userId } = req.user!;
    const module = String(req.params.module);

    if (!isValidModule(module)) {
      throw new AppError('Not found', 404);
    }

    // R17.8: Check module-level view permission (returns 404 to not reveal existence)
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    const fallback = await service.deleteUserPreference(tenantId, userId, module);

    // After deleting user pref, determine fallback source
    const source = await determineFallbackSource(tenantId, module);

    res.json({
      success: true,
      data: { module, source, columns: fallback.columns },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/columns/:module/tenant-default
 * Save tenant-level default column preference (admin only).
 */
export async function saveTenantDefault(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, userId } = req.user!;
    const module = String(req.params.module);

    if (!isValidModule(module)) {
      throw new AppError('Not found', 404);
    }

    // R17.8: Check module-level view permission (returns 404 to not reveal existence)
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    const ipAddress = extractIpAddress(req);

    const config = await service.upsertTenantDefault(
      tenantId,
      userId,
      module,
      { module, columns: req.body.columns },
      ipAddress,
    );

    res.json({
      success: true,
      data: { module, source: 'tenant' as ColumnSource, columns: config.columns },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/preferences/columns/:module/tenant-default
 * Delete tenant-level default, returning system default (admin only).
 */
export async function deleteTenantDefault(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, userId } = req.user!;
    const module = String(req.params.module);

    if (!isValidModule(module)) {
      throw new AppError('Not found', 404);
    }

    // R17.8: Check module-level view permission (returns 404 to not reveal existence)
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    const ipAddress = extractIpAddress(req);

    const fallback = await service.deleteTenantDefault(
      tenantId,
      userId,
      module,
      ipAddress,
    );

    res.json({
      success: true,
      data: { module, source: 'system' as ColumnSource, columns: fallback.columns },
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────

/**
 * Resolve effective columns and determine which source layer provided them.
 * Checks layers in order: user → tenant → system.
 */
async function resolveWithSource(
  tenantId: string,
  userId: string,
  module: string,
): Promise<{ config: { module: string; columns: unknown[] }; source: ColumnSource }> {
  const userPref = await repo.findUserPreference(tenantId, userId, module, 'columns');
  if (userPref) {
    const config = await service.resolveEffectiveColumns(tenantId, userId, module);
    return { config, source: 'user' };
  }

  const tenantPref = await repo.findTenantPreference(tenantId, module, 'columns');
  if (tenantPref) {
    const config = await service.resolveEffectiveColumns(tenantId, userId, module);
    return { config, source: 'tenant' };
  }

  const config = await service.resolveEffectiveColumns(tenantId, userId, module);
  return { config, source: 'system' };
}

/**
 * Determine the fallback source after a user preference has been deleted.
 * If tenant preference exists → "tenant", otherwise → "system".
 */
async function determineFallbackSource(
  tenantId: string,
  module: string,
): Promise<ColumnSource> {
  const tenantPref = await repo.findTenantPreference(tenantId, module, 'columns');
  return tenantPref ? 'tenant' : 'system';
}

/**
 * Extract client IP address from the request.
 * Prefers x-forwarded-for header (behind reverse proxy), falls back to req.ip.
 */
function extractIpAddress(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? undefined;
}
