import { PrismaClient } from '@prisma/client';
import { Role } from '../../shared/constants/roles';

const prisma = new PrismaClient();

// ── Permission row definitions ─────────────────────────────────────────────
// Only non-super roles get RolePermission rows.
// Client Admin / System Admin bypass all checks at the middleware level (isSuperRole()).

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

const GUEST_PERMISSIONS = [
  // ── Free sandbox plan: full CRUD on all basic CRM modules ─────────────────
  // Limits enforced by recordLimitGate (100 contacts, 3 users).
  // Premium features (campaigns, workflows) blocked by planGate (require PRO/ENTERPRISE).
  { module: 'dashboard',  canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  { module: 'contacts',   canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  { module: 'accounts',   canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  { module: 'deals',      canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  { module: 'tasks',      canView: true,  canCreate: true,  canEdit: true,  canDelete: true  },
  { module: 'settings',   canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'reports',    canView: true,  canCreate: false, canEdit: false, canDelete: false },
  // ── Premium features — view only; mutations blocked by planGate ───────────
  // canCreate/canEdit are intentionally false so the RBAC layer returns 403
  // before planGate even fires, giving users a consistent "upgrade required"
  // signal rather than a silent empty state.
  { module: 'campaigns',  canView: true,  canCreate: false, canEdit: false, canDelete: false },
  { module: 'workflows',  canView: true,  canCreate: false, canEdit: false, canDelete: false },
  // ── Team management: view only; limited to 3 users via recordLimitGate ────
  { module: 'users',      canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'roles',      canView: false, canCreate: false, canEdit: false, canDelete: false },
  // ── Billing: full access so Guest can upgrade ─────────────────────────────
  { module: 'billing',    canView: true,  canCreate: true,  canEdit: true,  canDelete: false },
  { module: 'audit',      canView: false, canCreate: false, canEdit: false, canDelete: false },
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
      name: Role.USER,
      description: 'Standard access for everyday operations, sales, and reporting.',
      isSystemRole: true,
      permissions: USER_PERMISSIONS,
    },
    {
      // Lifecycle role: used during the sandbox/guest phase (pre-subscription).
      // This is the role assigned at registration — NOT Client Admin.
      // Can browse demo CRM data and access billing to upgrade.
      name: Role.GUEST,
      description: 'Free sandbox plan. Full CRM CRUD (leads, contacts, deals, tasks). Limited to 100 contacts and 3 team members. Automation and campaigns require a paid plan.',
      isSystemRole: true,
      permissions: GUEST_PERMISSIONS,
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
