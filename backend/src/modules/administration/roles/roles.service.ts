import * as repo from './roles.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../shared/errors/http-error';
import type { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './roles.dto';

// Reserved names that cannot be used for custom roles (case-insensitive).
const RESERVED_ROLE_NAMES = ['admin', 'super user', 'user', 'restricted user', 'client admin', 'system admin'];

function isReservedName(name: string): boolean {
  return RESERVED_ROLE_NAMES.includes(name.toLowerCase().trim());
}

// ── Queries ───────────────────────────────────────────────────────────────

export async function getRoles(tenantId: string) {
  return repo.findAllRoles(tenantId);
}

export async function getRoleById(id: string, tenantId: string) {
  const role = await repo.findRoleById(id, tenantId);
  if (!role) throw new NotFoundError('Role');
  return role;
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createRole(tenantId: string, userId: string, dto: CreateRoleDto) {
  // Reserved name check
  if (isReservedName(dto.name)) {
    throw new ConflictError('A role with this name already exists');
  }

  // Uniqueness check within tenant
  const existing = await repo.findRoleByName(dto.name, tenantId);
  if (existing) throw new ConflictError('A role with this name already exists');

  const role = await repo.createRole(tenantId, { name: dto.name, description: dto.description }, dto.permissions ?? []);

  await writeAuditLog({
    tenantId, userId,
    action: 'role.created', entityType: 'RoleDefinition', entityId: role.id,
    after: { name: dto.name, permissionCount: (dto.permissions ?? []).length },
  });

  return role;
}

export async function updateRole(id: string, tenantId: string, userId: string, dto: UpdateRoleDto) {
  const role = await repo.findRoleById(id, tenantId);
  if (!role) throw new NotFoundError('Role');
  if (role.isSystemRole) throw new ForbiddenError('System roles cannot be modified');

  // Name uniqueness — exclude the current role
  if (dto.name) {
    const existing = await repo.findRoleByName(dto.name, tenantId);
    if (existing && existing.id !== id) throw new ConflictError('A role with this name already exists');
  }

  const metaFields: { name?: string; description?: string } = {};
  if (dto.name        !== undefined) metaFields.name        = dto.name;
  if (dto.description !== undefined) metaFields.description = dto.description;

  // Update meta fields if any
  let updated = role;
  if (Object.keys(metaFields).length > 0) {
    const result = await repo.updateRoleMeta(id, tenantId, metaFields);
    if (!result) throw new NotFoundError('Role');
    updated = result as typeof role;
  }

  // Replace permission rows if provided
  if (dto.permissions !== undefined) {
    await repo.upsertPermissions(id, tenantId, dto.permissions);
  }

  await writeAuditLog({
    tenantId, userId,
    action: 'role.updated', entityType: 'RoleDefinition', entityId: id,
    after: dto as Record<string, unknown>,
  });

  return updated;
}

export async function archiveRole(id: string, tenantId: string, userId: string) {
  const role = await repo.findRoleById(id, tenantId);
  if (!role) throw new NotFoundError('Role');
  if (role.isSystemRole) throw new ForbiddenError('System roles cannot be deleted');

  // Prevent archiving if users are still assigned
  const activeCount = await repo.countActiveUserRoles(id, tenantId);
  if (activeCount > 0) {
    throw new ConflictError(`Role has ${activeCount} assigned user${activeCount > 1 ? 's' : ''}. Reassign users before deleting.`);
  }

  await repo.archiveRole(id, tenantId);

  await writeAuditLog({
    tenantId, userId,
    action: 'role.archived', entityType: 'RoleDefinition', entityId: id,
  });
}

export async function assignRoleToUser(
  targetUserId: string, roleId: string, tenantId: string, actorId: string,
): ReturnType<typeof repo.assignRoleToUser> {
  // Verify role exists in this tenant
  const role = await repo.findRoleById(roleId, tenantId);
  if (!role) throw new NotFoundError('Role');

  const assignment = await repo.assignRoleToUser(targetUserId, roleId, tenantId);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'role.assigned', entityType: 'User', entityId: targetUserId,
    after: { roleId },
    severity: 'WARNING',
  });
  return assignment;
}

export async function removeRoleFromUser(
  targetUserId: string, roleId: string, tenantId: string, actorId: string,
): Promise<void> {
  await repo.removeRoleFromUser(targetUserId, roleId, tenantId);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'role.removed', entityType: 'User', entityId: targetUserId,
    after: { roleId },
    severity: 'WARNING',
  });
}

/**
 * Returns the effective resolved permissions for a user across all their assigned roles.
 * Super roles get full access on all modules.
 */
export async function getUserPermissions(
  userId: string,
  tenantId: string,
  userRole?: string,
): Promise<Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }>> {
  const FULL_ACCESS = { canView: true, canCreate: true, canEdit: true, canDelete: true };
  const superRoles = ['Admin', 'Super User', 'Client Admin', 'System Admin', 'client_admin', 'clientadmin', 'superuser', 'systemadmin', 'admin'];
  const normalizedRole = (userRole ?? '').toLowerCase().replace(/[\s_\-]/g, '');
  const isSuperRole = superRoles.some(r => r.toLowerCase().replace(/[\s_\-]/g, '') === normalizedRole);

  if (isSuperRole) {
    const modules = ['dashboard','contacts','accounts','deals','tasks','campaigns','workflows','settings','users','roles','reports','billing','audit'];
    return Object.fromEntries(modules.map(m => [m, FULL_ACCESS]));
  }

  return repo.findUserEffectivePermissions(userId, tenantId);
}
