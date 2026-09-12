import { Request, Response, NextFunction } from 'express';

import * as repo from './preferences.repository';
import { isValidModule, isValidSortField } from './column-registry';
import { AppError } from '../../shared/errors/app-error';
import { DEFAULT_ROLE_PERMISSIONS } from '../../core/permissions/permission.registry';
import { isSuperRole } from '../../shared/utils/is-super-role';

// ─────────────────────────────────────────────────────
// Table Preferences Controller
// Handles generic per-module preferences: pageSize, viewMode, sort
// Uses the existing UserPreference table with different keys.
// Unknown modules return 404 — never reveal module existence.
// ─────────────────────────────────────────────────────

// Map module IDs to their view permission key
// "leads" maps to "contacts.view" since they share the same permission surface
const MODULE_VIEW_PERMISSIONS: Record<string, string> = {
  leads: 'contacts.view',
  contacts: 'contacts.view',
  accounts: 'accounts.view',
  deals: 'deals.view',
};

/**
 * Check if user has view permission for the given module.
 * Returns true for super roles. Returns 404 (not 403) when denied.
 */
function hasModuleViewPermission(req: Request, module: string): boolean {
  const role = req.user?.role;
  if (!role) return false;

  // Super roles bypass all checks
  if (isSuperRole(role)) return true;

  const requiredPermission = MODULE_VIEW_PERMISSIONS[module];
  if (!requiredPermission) return true; // Unknown module — let isValidModule catch it

  const rolePermissions: string[] = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  return rolePermissions.includes(requiredPermission);
}

// Valid page sizes
const VALID_PAGE_SIZES = [10, 20, 25, 30, 40, 50];

// Valid view modes
const VALID_VIEW_MODES = ['wrap', 'clip'];

// Valid sort directions
const VALID_SORT_DIRECTIONS = ['asc', 'desc'];

/**
 * GET /api/v1/preferences/table/:module
 * Returns all table preferences (pageSize, viewMode, sort) for the authenticated user.
 */
export async function getTablePreferences(
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

    // R12 AC2: Check module-level view permission (returns 404 to not reveal existence)
    if (!hasModuleViewPermission(req, module)) {
      throw new AppError('Not found', 404);
    }

    // Fetch all table preference keys in parallel
    const [pageSizePref, viewModePref, sortPref] = await Promise.all([
      repo.findUserPreference(tenantId, userId, module, 'pageSize'),
      repo.findUserPreference(tenantId, userId, module, 'viewMode'),
      repo.findUserPreference(tenantId, userId, module, 'sort'),
    ]);

    const pageSize = parsePageSize(pageSizePref?.value);
    const viewMode = parseViewMode(viewModePref?.value);
    const rawSort = parseSort(sortPref?.value);

    // Discard stale sort if the field is no longer in the module's sortable fields
    const sort = rawSort && isValidSortField(module, rawSort.field) ? rawSort : null;

    res.json({
      success: true,
      data: { module, pageSize, viewMode, sort },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/table/:module/page-size
 * Save records-per-page preference.
 */
export async function savePageSize(
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

    const { pageSize } = req.body;

    if (!VALID_PAGE_SIZES.includes(pageSize)) {
      throw new AppError(
        `Invalid pageSize. Must be one of: ${VALID_PAGE_SIZES.join(', ')}`,
        400,
      );
    }

    await repo.upsertUserPreference(tenantId, userId, module, 'pageSize', { pageSize });

    res.json({
      success: true,
      data: { module, pageSize },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/table/:module/view-mode
 * Save view mode preference (wrap / clip).
 */
export async function saveViewMode(
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

    const { viewMode } = req.body;

    if (!VALID_VIEW_MODES.includes(viewMode)) {
      throw new AppError(
        `Invalid viewMode. Must be one of: ${VALID_VIEW_MODES.join(', ')}`,
        400,
      );
    }

    await repo.upsertUserPreference(tenantId, userId, module, 'viewMode', { viewMode });

    res.json({
      success: true,
      data: { module, viewMode },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/table/:module/sort
 * Save sort preference (field + direction), or clear if field is null/empty.
 */
export async function saveSort(
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

    const { field, direction } = req.body;

    // If field is null or empty, clear sort preference
    if (field === null || field === undefined || field === '') {
      await repo.deleteUserPreference(tenantId, userId, module, 'sort');
      res.json({
        success: true,
        data: { module, sort: null },
      });
      return;
    }

    if (typeof field !== 'string' || field.length > 100) {
      throw new AppError('Invalid sort field', 400);
    }

    if (!VALID_SORT_DIRECTIONS.includes(direction)) {
      throw new AppError(
        `Invalid sort direction. Must be one of: ${VALID_SORT_DIRECTIONS.join(', ')}`,
        400,
      );
    }

    await repo.upsertUserPreference(tenantId, userId, module, 'sort', { field, direction });

    res.json({
      success: true,
      data: { module, sort: { field, direction } },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/table/:module/sort (with null body to clear)
 * Also handles sort = null to clear the preference.
 */
export async function clearSort(
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

    await repo.deleteUserPreference(tenantId, userId, module, 'sort');

    res.json({
      success: true,
      data: { module, sort: null },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/preferences/table/:module/view-type
 * Returns the saved view type preference (table, list, kanban, etc.)
 */
export async function getViewType(
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

    const pref = await repo.findUserPreference(tenantId, userId, module, 'viewType');
    const viewType = parseViewType(pref?.value);

    res.json({
      success: true,
      data: { module, viewType },
    });
  } catch (err) {
    next(err);
  }
}

// Valid view types
const VALID_VIEW_TYPES = ['table', 'list', 'tile', 'kanban', 'grid', 'forecast'];

/**
 * PUT /api/v1/preferences/table/:module/view-type
 * Save view type preference.
 */
export async function saveViewType(
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

    const { viewType } = req.body;

    if (!viewType || typeof viewType !== 'string' || !VALID_VIEW_TYPES.includes(viewType)) {
      throw new AppError(
        `Invalid viewType. Must be one of: ${VALID_VIEW_TYPES.join(', ')}`,
        400,
      );
    }

    await repo.upsertUserPreference(tenantId, userId, module, 'viewType', { viewType });

    res.json({
      success: true,
      data: { module, viewType },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/preferences/table/:module/filters
 * Save filter conditions preference.
 */
export async function saveFilters(
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

    const { conditions } = req.body;

    if (!Array.isArray(conditions)) {
      throw new AppError('conditions must be an array', 400);
    }

    // Store filter conditions as JSON (max 50 filter conditions)
    if (conditions.length > 50) {
      throw new AppError('Maximum 50 filter conditions allowed', 400);
    }

    await repo.upsertUserPreference(tenantId, userId, module, 'filters', { conditions });

    res.json({
      success: true,
      data: { module, conditions },
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────

function parsePageSize(value: unknown): number {
  if (!value) return 25; // default
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (data && typeof data === 'object' && 'pageSize' in data) {
      const ps = (data as { pageSize: unknown }).pageSize;
      if (typeof ps === 'number' && VALID_PAGE_SIZES.includes(ps)) {
        return ps;
      }
    }
    return 25;
  } catch {
    return 25;
  }
}

function parseViewMode(value: unknown): string {
  if (!value) return 'wrap'; // default
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (data && typeof data === 'object' && 'viewMode' in data) {
      const vm = (data as { viewMode: unknown }).viewMode;
      if (typeof vm === 'string' && VALID_VIEW_MODES.includes(vm)) {
        return vm;
      }
    }
    return 'wrap';
  } catch {
    return 'wrap';
  }
}

function parseSort(value: unknown): { field: string; direction: string } | null {
  if (!value) return null;
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (
      data &&
      typeof data === 'object' &&
      'field' in data &&
      'direction' in data
    ) {
      const d = data as { field: unknown; direction: unknown };
      if (
        typeof d.field === 'string' &&
        typeof d.direction === 'string' &&
        VALID_SORT_DIRECTIONS.includes(d.direction)
      ) {
        return { field: d.field, direction: d.direction };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseViewType(value: unknown): string | null {
  if (!value) return null;
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (data && typeof data === 'object' && 'viewType' in data) {
      const vt = (data as { viewType: unknown }).viewType;
      if (typeof vt === 'string' && VALID_VIEW_TYPES.includes(vt)) {
        return vt;
      }
    }
    return null;
  } catch {
    return null;
  }
}
