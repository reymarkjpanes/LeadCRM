import { PrismaClient } from '@prisma/client';
import { Role } from '../../shared/constants/roles';

const prisma = new PrismaClient();

// ── Permission row definitions ─────────────────────────────────────────────
// Only non-super roles get RolePermission rows.
// Admin / Super User bypass all checks at the middleware level (isSuperRole()).

const USER_PERMISSIONS = [
  { module: 'dashboard',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'contacts',      canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'accounts',      canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'deals',         canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'tasks',         canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'campaigns',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'workflows',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'settings',      canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'reports',       canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'users',         canView: false, canCreate: false, canEdit: false, canDelete: false },
  { module: 'roles',         canView: false, canCreate: false, canEdit: false, canDelete: false },
  { module: 'billing',       canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'audit',         canView: false, canCreate: false, canEdit: false, canDelete: false },
];

const RESTRICTED_USER_PERMISSIONS = [
  { module: 'dashboard',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'contacts',      canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'accounts',      canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'deals',         canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'tasks',         canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'campaigns',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'workflows',     canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'settings',      canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'reports',       canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'users',         canView: false, canCreate: false, canEdit: false, canDelete: false },
  { module: 'roles',         canView: false, canCreate: false, canEdit: false, canDelete: false },
  // canEdit: true enables billing.manage — required to initiate a Stripe checkout/upgrade
  // from a sandbox workspace. Restricted Users cannot manage other users or roles,
  // but they must be able to upgrade their own workspace to a paid plan.
  { module: 'billing',       canView: true,  canCreate: false, canEdit: true,  canDelete: false },
  { module: 'audit',         canView: false, canCreate: false, canEdit: false, canDelete: false },
];

export async function seedSystemRoles(tenantId: string): Promise<void> {
  console.log(`[Seed] Seeding system roles for tenant ${tenantId}...`);

  const systemRoles = [
    {
      // Lifecycle role: assigned at registration (sandbox/pre-subscription state).
      // Promoted to Client Admin only after successful Stripe payment via webhook.
      // No RolePermission rows — bypasses checks via isSuperRole() after promotion.
      name: Role.CLIENT_ADMIN,
      description: 'Full tenant ownership. Manages users, roles, billing, and all CRM data. Assigned after successful subscription.',
      isSystemRole: true,
      permissions: null, // Client Admin bypasses all RolePermission checks via isSuperRole()
    },
    {
      name: Role.ADMIN,
      description: 'Full administrative access to all features and settings within the tenant.',
      isSystemRole: true,
      permissions: null, // Admin bypasses all checks — no RolePermission rows needed
    },
    {
      name: Role.SUPER_USER,
      description: 'Advanced user with access to most features and settings, excluding sensitive billing operations.',
      isSystemRole: true,
      permissions: null, // Super User bypasses all checks — no RolePermission rows needed
    },
    {
      name: Role.USER,
      description: 'Standard access for everyday operations, sales, and reporting.',
      isSystemRole: true,
      permissions: USER_PERMISSIONS,
    },
    {
      // Lifecycle role: used during the sandbox/guest phase (pre-subscription).
      // This is the role assigned at registration — NOT Client Admin.
      // Can browse demo CRM data and access billing to upgrade.
      name: Role.RESTRICTED_USER,
      description: 'Sandbox/pre-subscription access. Can view demo CRM data and initiate a plan subscription.',
      isSystemRole: true,
      permissions: RESTRICTED_USER_PERMISSIONS,
    },
  ];

  for (const roleDef of systemRoles) {
    // Upsert the RoleDefinition
    const role = await prisma.roleDefinition.upsert({
      where: { tenantId_name: { tenantId, name: roleDef.name } },
      update: { description: roleDef.description, isSystemRole: roleDef.isSystemRole },
      create: { tenantId, name: roleDef.name, description: roleDef.description, isSystemRole: roleDef.isSystemRole },
    });

    // Upsert RolePermission rows for roles that have them
    if (roleDef.permissions) {
      for (const perm of roleDef.permissions) {
        await prisma.rolePermission.upsert({
          where: { roleId_module: { roleId: role.id, module: perm.module } },
          update: { canView: perm.canView, canCreate: perm.canCreate, canEdit: perm.canEdit, canDelete: perm.canDelete },
          create: {
            tenantId,
            roleId: role.id,
            module: perm.module,
            canView: perm.canView,
            canCreate: perm.canCreate,
            canEdit: perm.canEdit,
            canDelete: perm.canDelete,
          },
        });
      }
    }
  }

  console.log(`[Seed] System roles seeded for tenant ${tenantId}.`);
}

// ── Standalone runner ─────────────────────────────────────────────────────
if (require.main === module) {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Usage: ts-node roles.seed.ts <tenantId>');
    process.exit(1);
  }
  
  seedSystemRoles(tenantId)
    .catch((err) => { console.error('[Seed] Error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
