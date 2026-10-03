import { PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database.config';

/** Tenant provisioning seeds only the predefined Client Admin role. */
export async function seedSystemRoles(tenantId: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  const role = await db.roleDefinition.upsert({
    where: { tenantId_name: { tenantId, name: 'Client Admin' } },
    update: { isSystemRole: true, isArchived: false },
    create: { tenantId, name: 'Client Admin', isSystemRole: true, description: 'Manages Camxian users, custom roles, and CRM data.' },
  });
  for (const module of PERMISSION_MODULES) {
    const flags = { ...EMPTY_PERMISSION_FLAGS, ...Object.fromEntries(module.actions.map(action => [action, true])) };
    await db.rolePermission.upsert({ where: { roleId_module: { roleId: role.id, module: module.key } },
      create: { tenantId, roleId: role.id, module: module.key, ...flags }, update: flags });
  }
}
