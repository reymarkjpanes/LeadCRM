import { type ResolvedPermissions } from '@leadcrm/shared';
import * as repo from './roles.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../shared/errors/http-error';
import type { CreateRoleDto, UpdateRoleDto } from './roles.dto';
import { Prisma } from '@prisma/client';

// Reserved names that cannot be used for custom roles (case-insensitive).
// Includes legacy role names to prevent re-creation of removed system roles.
const RESERVED_ROLE_NAMES = [
  'guest', 'clientadmin', 'systemadmin',
];

function isReservedName(name: string): boolean {
  return RESERVED_ROLE_NAMES.includes(name.toLowerCase().replace(/[\s_-]/g, ''));
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
    throw new ConflictError('A role with this name already exists.');
  }

  // Uniqueness check within tenant
  const existing = await repo.findRoleByName(dto.name, tenantId);
  if (existing) throw new ConflictError('A role with this name already exists.');

  let role;
  try {
    role = await repo.createRole(tenantId, { name: dto.name, description: dto.description }, dto.permissions ?? [],
      (tx, created) => writeAuditLog({ tenantId, userId, action: 'role.created', entityType: 'RoleDefinition', entityId: created.id,
        after: { name: dto.name, permissionCount: (dto.permissions ?? []).length } }, tx));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('A role with this name already exists.');
    }
    throw error;
  }

  return role;
}

export async function updateRole(id: string, tenantId: string, userId: string, dto: UpdateRoleDto) {
  const role = await repo.findRoleById(id, tenantId);
  if (!role) throw new NotFoundError('Role');
  if (role.isSystemRole) throw new ForbiddenError('System roles cannot be modified');

  // Name uniqueness — exclude the current role
  if (dto.name) {
    if (isReservedName(dto.name)) throw new ConflictError('This role name is reserved');
    const existing = await repo.findRoleByName(dto.name, tenantId);
    if (existing && existing.id !== id) throw new ConflictError('A role with this name already exists.');
  }

  const metaFields: { name?: string; description?: string } = {};
  if (dto.name        !== undefined) metaFields.name        = dto.name;
  if (dto.description !== undefined) metaFields.description = dto.description;

  await repo.updateRoleAndPermissions(id, tenantId, metaFields, dto.permissions, tx => writeAuditLog({
    tenantId, userId,
    action: 'role.updated', entityType: 'RoleDefinition', entityId: id,
    after: dto as Record<string, unknown>,
  }, tx), userId);

  return getRoleById(id, tenantId);
}

export async function archiveRole(id: string, tenantId: string, userId: string) {
  await repo.archiveRole(id, tenantId, (tx, role) => writeAuditLog({
    tenantId, userId,
    action: 'role.deleted', entityType: 'RoleDefinition', entityId: id,
    before: { name: role.name, isArchived: false }, after: { name: role.name, isArchived: true },
  }, tx));
}

export async function assignRoleToUser(
  targetUserId: string, roleId: string, tenantId: string, actorId: string,
): ReturnType<typeof repo.assignRoleToUser> {
  // Verify role exists in this tenant
  const role = await repo.findRoleById(roleId, tenantId);
  if (!role) throw new NotFoundError('Role');

  if (role.isArchived || role.isSystemRole || isReservedName(role.name)) {
    throw new ForbiddenError('Select an active custom role');
  }
  const assignment = await repo.assignRoleToUser(targetUserId, roleId, tenantId, tx => writeAuditLog({
    tenantId, userId: actorId,
    action: 'role.assigned', entityType: 'User', entityId: targetUserId,
    after: { roleId },
    severity: 'WARNING',
  }, tx), actorId);
  return assignment;
}

export async function removeRoleFromUser(
  targetUserId: string, roleId: string, tenantId: string, actorId: string,
): Promise<void> {
  await repo.removeRoleFromUser(targetUserId, roleId, tenantId, tx => writeAuditLog({
    tenantId, userId: actorId,
    action: 'role.removed', entityType: 'User', entityId: targetUserId,
    after: { roleId },
    severity: 'WARNING',
  }, tx));
}

/**
 * Returns the effective resolved permissions for a user across all their assigned roles.
 * Super roles get full access on all modules.
 */
export async function getUserPermissions(
  userId: string,
  tenantId: string,
): Promise<ResolvedPermissions> {
  return repo.findUserEffectivePermissions(userId, tenantId);
}
