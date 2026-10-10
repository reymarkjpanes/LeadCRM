import { normalizeModuleColumns } from '@leadcrm/shared';
import type { ColumnConfig, ColumnConfigItem } from '@leadcrm/shared';
import { SaveColumnsBodySchema } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';

import * as repo from './preferences.repository';
import {
  getRegistryForModule,
  getSystemDefault,
  getRequiredColumnIds,
} from './column-registry';
import { writeAuditLog } from '../../core/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';

// ─────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────

const PREFERENCE_KEY = 'columns';

// ─────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────

/**
 * Resolve the effective column configuration for a user following
 * the hierarchy: User > Tenant > System.
 *
 * Each layer is a full replacement — no per-column merge.
 * Corrupted layers are skipped gracefully.
 */
export async function resolveEffectiveColumns(
  tenantId: string,
  userId: string,
  module: string,
): Promise<ColumnConfig> {
  // 1. Try User Preference
  const userPref = await repo.findUserPreference(tenantId, userId, module, PREFERENCE_KEY);
  if (userPref) {
    const parsed = parseStoredValue(userPref.value);
    if (parsed) {
      return reconcileWithRegistry({ module, columns: parsed }, module);
    }
    // Corrupted user pref — fall through to tenant layer
  }

  // 2. Try Tenant Preference
  const tenantPref = await repo.findTenantPreference(tenantId, module, PREFERENCE_KEY);
  if (tenantPref) {
    const parsed = parseStoredValue(tenantPref.value);
    if (parsed) {
      return reconcileWithRegistry({ module, columns: parsed }, module);
    }
    // Corrupted tenant pref — fall through to system default
  }

  // 3. Return System Default
  return getSystemDefault(module);
}

// ─────────────────────────────────────────────────────
// RECONCILIATION
// ─────────────────────────────────────────────────────

/**
 * Reconcile a stored column config against the current Column Registry:
 * 1. Strip stale columns (no longer in registry)
 * 2. Insert new registry columns at their default position/visibility
 * 3. Ensure required columns have visible: true
 */
export function reconcileWithRegistry(config: ColumnConfig, module: string): ColumnConfig {
  const registry = getRegistryForModule(module);
  if (!registry) {
    return config;
  }

  const registryIds = new Set(registry.columns.map((col) => col.id));
  const requiredIds = new Set(getRequiredColumnIds(module));

  // 1. Strip stale columns that no longer exist in registry
  const storedColumns = normalizeModuleColumns(module, config.columns);
  const validColumns = storedColumns.filter((col) => registryIds.has(col.id));

  // 2. Find registry columns NOT in the config
  const existingIds = new Set(validColumns.map((col) => col.id));
  const missingColumns: ColumnConfigItem[] = registry.columns
    .filter((regCol) => !existingIds.has(regCol.id))
    .map((regCol) => ({
      id: regCol.id,
      visible: regCol.defaultVisible,
      order: regCol.defaultOrder,
    }));

  // 3. Merge existing + missing columns
  const allColumns = [...validColumns, ...missingColumns];

  // 4. Ensure required columns have visible: true
  const reconciledColumns = allColumns.map((col) => {
    if (requiredIds.has(col.id) && !col.visible) {
      return { ...col, visible: true };
    }
    return col;
  });

  return { module, columns: reconciledColumns };
}

// ─────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────

/**
 * Validate a column configuration against the Column Registry.
 * Returns a ValidationResult indicating success or field-level errors.
 *
 * Checks performed:
 * 1. All column ids exist in registry
 * 2. No required columns have visible: false
 * 3. No duplicate column ids
 * 4. Order values are non-negative integers and don't exceed column count
 * 5. Total columns don't exceed registry size
 */
export function validateAgainstRegistry(config: ColumnConfig, module: string): ValidationResult {
  const registry = getRegistryForModule(module);
  if (!registry) {
    return { valid: false, errors: [{ field: 'module', reason: `Module '${module}' not found in registry` }] };
  }

  const errors: ValidationError[] = [];
  const registryIds = new Set(registry.columns.map((col) => col.id));
  const requiredIds = new Set(getRequiredColumnIds(module));
  const registrySize = registry.columns.length;

  // Check total columns don't exceed registry size
  if (config.columns.length > registrySize) {
    errors.push({
      field: 'columns',
      reason: `Configuration contains ${config.columns.length} columns but registry only defines ${registrySize}`,
    });
  }

  // Check for duplicate column ids
  const seenIds = new Set<string>();
  for (let i = 0; i < config.columns.length; i++) {
    const col = config.columns[i];

    if (seenIds.has(col.id)) {
      errors.push({
        field: `columns[${i}].id`,
        reason: `Duplicate column id '${col.id}'`,
      });
    }
    seenIds.add(col.id);

    // Check column id exists in registry
    if (!registryIds.has(col.id)) {
      errors.push({
        field: `columns[${i}].id`,
        reason: `Column '${col.id}' not found in ${module} registry`,
      });
    }

    // Check required columns are not hidden
    if (requiredIds.has(col.id) && !col.visible) {
      errors.push({
        field: `columns[${i}].visible`,
        reason: `Column '${col.id}' is required and cannot be hidden`,
      });
    }

    // Check order is non-negative integer and within bounds
    if (!Number.isInteger(col.order) || col.order < 0) {
      errors.push({
        field: `columns[${i}].order`,
        reason: `Order must be a non-negative integer, got ${col.order}`,
      });
    } else if (col.order > registrySize) {
      errors.push({
        field: `columns[${i}].order`,
        reason: `Order value ${col.order} exceeds registry column count (${registrySize})`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────
// HELPERS (PRIVATE)
// ─────────────────────────────────────────────────────

/**
 * Parse and validate stored preference value from the database.
 * Returns the columns array if valid, or null if corrupted/invalid.
 *
 * The stored value shape is:
 * { columns: [{ id: string, visible: boolean, order: number }, ...] }
 */
function parseStoredValue(value: unknown): ColumnConfigItem[] | null {
  try {
    // Value might already be parsed (Prisma Json field)
    const data = typeof value === 'string' ? JSON.parse(value) : value;

    // Validate using Zod schema from shared package
    const result = SaveColumnsBodySchema.safeParse(data);
    if (!result.success) {
      return null;
    }

    return result.data.columns;
  } catch {
    // JSON parse error or any unexpected error — treat as corrupted
    return null;
  }
}


// ─────────────────────────────────────────────────────
// USER PREFERENCE CRUD
// ─────────────────────────────────────────────────────

/**
 * Create or update a user's column preference for a module.
 * Validates against registry, reconciles required columns, persists, and returns effective config.
 */
export async function upsertUserPreference(
  tenantId: string,
  userId: string,
  module: string,
  config: ColumnConfig,
): Promise<ColumnConfig> {
  // 1. Validate config against registry
  const validation = validateAgainstRegistry(config, module);
  if (!validation.valid) {
    const details = validation.errors.map((e) => `${e.field}: ${e.reason}`).join('; ');
    throw new AppError(`Column configuration validation failed: ${details}`, 400);
  }

  // 2. Reconcile (auto-include missing required columns)
  const reconciled = reconcileWithRegistry(config, module);

  // 3. Persist — store as { columns: [...] }
  await repo.upsertUserPreference(tenantId, userId, module, PREFERENCE_KEY, {
    columns: reconciled.columns,
  } as unknown as Prisma.InputJsonValue);

  // 4. Return effective columns
  return reconciled;
}

/**
 * Delete a user's column preference for a module.
 * After deletion, returns the fallback effective columns (tenant default or system default).
 */
export async function deleteUserPreference(
  tenantId: string,
  userId: string,
  module: string,
): Promise<ColumnConfig> {
  // 1. Delete user preference
  await repo.deleteUserPreference(tenantId, userId, module, PREFERENCE_KEY);

  // 2. Return fallback (resolve without user layer)
  return resolveEffectiveColumns(tenantId, userId, module);
}

// ─────────────────────────────────────────────────────
// TENANT DEFAULT CRUD
// ─────────────────────────────────────────────────────

/**
 * Create or update a tenant-level default column preference for a module.
 * Validates, reconciles, persists, writes fire-and-forget audit log, and returns config.
 */
export async function upsertTenantDefault(
  tenantId: string,
  userId: string,
  module: string,
  config: ColumnConfig,
  ipAddress?: string,
): Promise<ColumnConfig> {
  // 1. Validate config against registry
  const validation = validateAgainstRegistry(config, module);
  if (!validation.valid) {
    const details = validation.errors.map((e) => `${e.field}: ${e.reason}`).join('; ');
    throw new AppError(`Column configuration validation failed: ${details}`, 400);
  }

  // 2. Check if existing record exists (for audit before/after)
  const existing = await repo.findTenantPreference(tenantId, module, PREFERENCE_KEY);

  // 3. Reconcile (auto-include missing required columns)
  const reconciled = reconcileWithRegistry(config, module);

  // 4. Persist
  const record = await repo.upsertTenantPreference(tenantId, module, PREFERENCE_KEY, {
    columns: reconciled.columns,
  } as unknown as Prisma.InputJsonValue);

  // 5. Fire-and-forget audit log
  const action = existing
    ? 'preference.tenant_default.updated'
    : 'preference.tenant_default.created';

  writeAuditLog({
    tenantId,
    userId,
    action,
    entityType: 'TenantPreference',
    entityId: record.id,
    before: existing ? (existing.value as Record<string, unknown>) : undefined,
    after: { columns: reconciled.columns } as Record<string, unknown>,
    ipAddress,
  }).catch((err) => {
    console.warn('[PreferencesService] Audit log write failed:', err);
  });

  // 6. Return reconciled config
  return reconciled;
}

/**
 * Delete a tenant-level default column preference for a module.
 * Writes fire-and-forget audit log if record existed, then returns system default.
 */
export async function deleteTenantDefault(
  tenantId: string,
  userId: string,
  module: string,
  ipAddress?: string,
): Promise<ColumnConfig> {
  // 1. Get existing record for audit trail
  const existing = await repo.findTenantPreference(tenantId, module, PREFERENCE_KEY);

  // 2. Delete the tenant preference
  await repo.deleteTenantPreference(tenantId, module, PREFERENCE_KEY);

  // 3. Fire-and-forget audit log (only if record existed)
  if (existing) {
    writeAuditLog({
      tenantId,
      userId,
      action: 'preference.tenant_default.deleted',
      entityType: 'TenantPreference',
      entityId: existing.id,
      before: existing.value as Record<string, unknown>,
      ipAddress,
    }).catch((err) => {
      console.warn('[PreferencesService] Audit log write failed:', err);
    });
  }

  // 4. Return system default
  return getSystemDefault(module);
}
