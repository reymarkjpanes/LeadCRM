import { PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS, type PermissionFlags, type ResolvedPermissions } from '@leadcrm/shared';
import { ForbiddenError, NotFoundError, ConflictError } from '../../../shared/errors/http-error';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { requireEmployeeAccount } from '../../../core/auth/account-access';
import { isSalesRoleName } from '../../crm/access/crm-record-access.service';

type RoleAudit = (tx: Prisma.TransactionClient, role: { id: string; name: string }) => Promise<void>;
type AssignmentAudit = (tx: Prisma.TransactionClient) => Promise<void>;

// ── Read ──────────────────────────────────────────────────────────────────

export async function findAllRoles(tenantId: string) {
  return prisma.roleDefinition.findMany({
    where: { tenantId, isArchived: false, NOT: { name: { equals: 'Guest', mode: 'insensitive' } } },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { userRoles: true } },
      permissions: {
        select: { id: true, roleId: true, module: true, canView: true, canViewAll: true, canViewMy: true, canViewActive: true, canCreate: true, canEdit: true, canDelete: true, canArchive: true, canImport: true, canManageStages: true, canComplete: true, canAssign: true, canSend: true, canDuplicate: true, canViewReports: true, canActivate: true, canPause: true, canExecute: true, canViewRuns: true, canPublish: true, canViewSubmissions: true, canViewClosedWon: true, canDisable: true, canRestore: true },
      },
    },
  });
}

/** Full detail: includes RolePermission rows and assigned users. */
export async function findRoleById(id: string, tenantId: string) {
  return prisma.roleDefinition.findFirst({
    where: { id, tenantId, isArchived: false, NOT: { name: { equals: 'Guest', mode: 'insensitive' } } },
    include: {
      _count: { select: { userRoles: true } },
      permissions: {
        select: { id: true, roleId: true, module: true, canView: true, canViewAll: true, canViewMy: true, canViewActive: true, canCreate: true, canEdit: true, canDelete: true, canArchive: true, canImport: true, canManageStages: true, canComplete: true, canAssign: true, canSend: true, canDuplicate: true, canViewReports: true, canActivate: true, canPause: true, canExecute: true, canViewRuns: true, canPublish: true, canViewSubmissions: true, canViewClosedWon: true, canDisable: true, canRestore: true },
      },
      userRoles: {
        where: { tenantId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true },
          },
        },
        take: 50,
      },
    },
  });
}

export async function findRoleByName(name: string, tenantId: string) {
  return prisma.roleDefinition.findFirst({
    where: { tenantId, name: { equals: name, mode: 'insensitive' } },
  });
}

// ── Write ─────────────────────────────────────────────────────────────────

export async function createRole(
  tenantId: string,
  data: { name: string; description?: string },
  permissions: Array<PermissionFlags & { module: string }>,
  audit?: RoleAudit,
) {
  return roleNameTransaction(async (tx) => {
    // Serialize tenant role-name writes so case-insensitive uniqueness survives races.
    if (await tx.roleDefinition.findFirst({ where: { tenantId, name: { equals: data.name, mode: 'insensitive' } } })) {
      throw new ConflictError('A role with this name already exists.');
    }
    const role = await tx.roleDefinition.create({
      data: { tenantId, name: data.name, description: data.description, isSystemRole: false, crmAssignmentRestricted: isSalesRoleName(data.name) },
    });
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({
          tenantId,
          roleId: role.id,
          ...EMPTY_PERMISSION_FLAGS, ...p,
        })),
      });
    }
    await audit?.(tx, role);
    return tx.roleDefinition.findUniqueOrThrow({
      where: { id: role.id },
      include: { permissions: { select: { id: true, roleId: true, module: true, canView: true, canViewAll: true, canViewMy: true, canViewActive: true, canCreate: true, canEdit: true, canDelete: true, canArchive: true, canImport: true, canManageStages: true, canComplete: true, canAssign: true, canSend: true, canDuplicate: true, canViewReports: true, canActivate: true, canPause: true, canExecute: true, canViewRuns: true, canPublish: true, canViewSubmissions: true, canViewClosedWon: true, canDisable: true, canRestore: true } }, _count: { select: { userRoles: true } } },
    });
  });
}

export async function updateRoleMeta(
  id: string,
  tenantId: string,
  data: { name?: string; description?: string },
) {
  return updateRoleAndPermissions(id, tenantId, data);
}

/** Metadata, the primary-role label and permission rows commit together. */
export async function updateRoleAndPermissions(
  id: string,
  tenantId: string,
  data: { name?: string; description?: string },
  permissions?: Array<PermissionFlags & { module: string }>,
  audit?: RoleAudit,
  actorId?: string,
) {
  return roleNameTransaction(async tx => {
    const existing = await tx.roleDefinition.findFirst({ where: { id, tenantId, isArchived: false } });
    if (!existing) throw new NotFoundError('Role');
    if (existing.isSystemRole) throw new ForbiddenError('System roles cannot be modified');
    if (permissions !== undefined && actorId) {
      const actor = await tx.user.findFirst({ where: { id: actorId, tenantId, status: 'ACTIVE' }, select: { role: true } });
      if (!actor || actor.role !== 'Client Admin' && await tx.userRole.findFirst({ where: { tenantId, userId: actorId, roleId: id } })) {
        throw new ForbiddenError('Ask another authorized administrator to change permissions for a role assigned to you.');
      }
    }
    if (data.name && await tx.roleDefinition.findFirst({ where: { tenantId, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } } })) {
      throw new ConflictError('A role with this name already exists.');
    }
    const role = Object.keys(data).length ? await tx.roleDefinition.update({ where: { id, tenantId },
      data: { ...data, crmAssignmentRestricted: existing.crmAssignmentRestricted || isSalesRoleName(existing.name) || !!data.name && isSalesRoleName(data.name) } }) : existing;
    if (data.name && data.name !== existing.name) {
      await tx.user.updateMany({ where: { tenantId, role: existing.name }, data: { role: data.name } });
    }
    if (permissions !== undefined) await replacePermissions(tx, id, tenantId, permissions);
    await audit?.(tx, role);
    return role;
  });
}

/**
 * Upsert a role's full permission set.
 * Omitted modules have their rows deleted (full replacement semantics).
 */
export async function upsertPermissions(
  roleId: string,
  tenantId: string,
  permissions: Array<PermissionFlags & { module: string }>,
): Promise<void> {
  await updateRoleAndPermissions(roleId, tenantId, {}, permissions);
}

async function replacePermissions(tx: Prisma.TransactionClient, roleId: string, tenantId: string,
  permissions: Array<PermissionFlags & { module: string }>) {
  const incomingModules = permissions.map(p => p.module);
  await tx.rolePermission.deleteMany({ where: { roleId, tenantId, module: { notIn: incomingModules } } });
  for (const p of permissions) {
    // Legacy clients omit tab flags. Preserve stored grants, except when View is removed.
    const { canViewAll: _all, canViewMy: _my, canViewActive: _active, canPause: _pause, canExecute: _execute, ...legacyDefaults } = EMPTY_PERMISSION_FLAGS;
    const tabs = Object.fromEntries(['canViewAll', 'canViewMy', 'canViewActive', 'canPause', 'canExecute'].flatMap(key =>
      !p.canView ? [[key, false]] : p[key as keyof PermissionFlags] === undefined ? [] : [[key, p[key as keyof PermissionFlags]] ]));
    await tx.rolePermission.upsert({
      where: { roleId_module: { roleId, module: p.module } },
      create: { tenantId, roleId, ...EMPTY_PERMISSION_FLAGS, ...p },
      update: { ...legacyDefaults, ...p, ...tabs },
    });
  }
}

export async function archiveRole(id: string, tenantId: string, audit?: RoleAudit) {
  return prisma.$transaction(async tx => {
    // Only this fixed, parameterized lock leaves automatic tenant scoping.
    await tenantContext.exit(async () => await tx.$queryRaw`SELECT "id" FROM "RoleDefinition" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`);
    const role = await tx.roleDefinition.findFirst({ where: { id, tenantId, isArchived: false } });
    if (!role) throw new NotFoundError('Role');
    if (role.isSystemRole) throw new ForbiddenError('System roles cannot be deleted');
    const count = await tx.userRole.count({ where: { roleId: id, tenantId } });
    if (count > 0) throw new ConflictError(`Role has ${count} assigned user(s). Reassign users to another role before deleting.`);
    const updated = await tx.roleDefinition.update({ where: { id, tenantId, isArchived: false }, data: { isArchived: true } });
    await audit?.(tx, updated);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

// ── User–Role junction ────────────────────────────────────────────────────

export async function assignRoleToUser(userId: string, roleId: string, tenantId: string, audit?: AssignmentAudit, actorId?: string) {
  return prisma.$transaction(async tx => {
    const role = await tx.roleDefinition.findFirst({ where: { id: roleId, tenantId, isArchived: false } });
    if (!role) throw new NotFoundError('Role');
    await replaceUserRole(tx, userId, tenantId, role.name, actorId);
    await audit?.(tx);
    return tx.userRole.findUniqueOrThrow({ where: { userId_roleId_tenantId: { userId, roleId, tenantId } } });
  });
}

export async function removeRoleFromUser(userId: string, roleId: string, tenantId: string, audit?: AssignmentAudit) {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
    const role = await tx.roleDefinition.findFirst({ where: { id: roleId, tenantId } });
    if (!user || !role) throw new NotFoundError('User or role');
    if (user.role === 'Client Admin' || user.role === role.name) {
      throw new ForbiddenError('Assign a replacement custom role before removing the primary role');
    }
    const removed = await tx.userRole.deleteMany({ where: { userId, roleId, tenantId } });
    await audit?.(tx);
    return removed;
  });
}

export async function countActiveUserRoles(roleId: string, tenantId: string): Promise<number> {
  return prisma.userRole.count({ where: { roleId, tenantId } });
}

// ── Permissions ───────────────────────────────────────────────────────────

/**
 * Resolve the current database identity, then combine its valid custom roles.
 * A protected system-role junction cannot elevate a custom user's identity.
 */
export async function findUserEffectivePermissions(
  userId: string,
  tenantId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<ResolvedPermissions> {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      role: true, status: true,
      userRoles: {
        where: { tenantId, role: { tenantId, isArchived: false } },
        include: { role: { include: { permissions: { where: { tenantId } } } } },
      },
    },
  });
  if (!user) throw new NotFoundError('User');
  return resolveEffectivePermissions(user);
}

/** Shared resolver for request authorization and CRM record scope. */
export function resolveEffectivePermissions(user: {
  role: string; status: string; userRoles: Array<{ role: { name: string; isSystemRole: boolean; permissions: Array<PermissionFlags & { module: string }> } }>;
}): ResolvedPermissions {
  if (user.status !== 'ACTIVE') return {};
  if (user.role === 'Client Admin') {
    return Object.fromEntries(PERMISSION_MODULES.map(module => [module.key, {
      ...EMPTY_PERMISSION_FLAGS, ...Object.fromEntries(module.actions.map(action => [action, true])),
    }]));
  }
  const userRoles = user.userRoles.filter(({ role }) => !role.isSystemRole &&
    !['guest', 'clientadmin', 'systemadmin'].includes(role.name.toLowerCase().replace(/[\s_-]/g, '')));
  // Never invent a primary assignment from the label or inherit an unrelated role.
  if (!userRoles.some(({ role }) => role.name === user.role)) return {};

  const resolved: ResolvedPermissions = {};
  for (const ur of userRoles) {
    for (const perm of ur.role.permissions) {
      const module = PERMISSION_MODULES.find(m => m.key === perm.module);
      if (!module) continue;
      const flags = resolved[module.key] ??= { ...EMPTY_PERMISSION_FLAGS };
      for (const action of module.actions) flags[action] = flags[action] === true || perm[action] === true;
    }
  }

  return resolved;
}

// Prisma type alias kept for import compatibility
export type { Prisma };

/** User management selects a primary role; update both RBAC representations in its transaction. */
export async function replaceUserRole(
  tx: Prisma.TransactionClient, userId: string, tenantId: string, roleName: string, actorId?: string,
): Promise<void> {
  // Shared with deletion's exclusive lock; recheck active state after any wait.
  await tenantContext.exit(async () => await tx.$queryRaw`SELECT "id" FROM "RoleDefinition" WHERE "tenantId" = ${tenantId} AND "name" = ${roleName} FOR SHARE`);
  const [user, role] = await Promise.all([
    tx.user.findFirst({ where: { id: userId, tenantId } }),
    tx.roleDefinition.findFirst({ where: { tenantId, name: roleName, isArchived: false } }),
  ]);
  if (!user || !role) throw new NotFoundError('User or role');
  if (actorId === userId && user.role !== 'Client Admin' && user.role !== role.name) {
    throw new ForbiddenError('Ask another authorized administrator to change your role.');
  }
  if (['Client Admin'].includes(user.role) || role.isSystemRole ||
      ['guest', 'clientadmin'].includes(role.name.toLowerCase().replace(/[\s_-]/g, ''))) {
    throw new ForbiddenError('Select an active custom role for a non-administrator user');
  }
  await requireEmployeeAccount({ ...user, role: role.name }, tx);
  await tx.user.update({ where: { id: user.id }, data: { role: role.name } });
  await tx.userRole.deleteMany({ where: { userId, tenantId, roleId: { not: role.id }, role: { tenantId, name: user.role } } });
  await tx.userRole.upsert({
    where: { userId_roleId_tenantId: { userId, roleId: role.id, tenantId } },
    create: { userId, tenantId, roleId: role.id }, update: {},
  });
}

async function roleNameTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
}
