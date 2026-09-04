/**
 * repair-role-permissions.ts
 *
 * One-time idempotent data repair script.
 *
 * PURPOSE
 * -------
 * Renames all RolePermission rows that use module = 'organizations' to
 * module = 'accounts' across every tenant.
 *
 * BACKGROUND
 * ----------
 * roles.seed.ts historically seeded RolePermission rows with
 * module = 'organizations'. The CRM routes use authorize('accounts.*'),
 * so any non-super user got 403 on all /crm/accounts/ endpoints because
 * the RBAC middleware found no matching RolePermission row for module
 * 'accounts'. This script corrects all existing rows.
 *
 * roles.seed.ts has been updated so newly seeded tenants get
 * module = 'accounts' going forward.
 *
 * Also backfills missing UserRole junction rows so every user whose
 * User.role string has a matching RoleDefinition in their tenant has a
 * UserRole record, enabling the live DB RBAC path in rbac.middleware.ts.
 *
 * WHEN TO RUN
 * -----------
 * Run once against every environment (dev, staging, production) after
 * deploying this code. Safe to run again — fully idempotent.
 *
 * HOW TO RUN
 * ----------
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/repair-role-permissions.ts
 *
 * Or add to your deployment runbook for one-time execution.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function repairRolePermissions(): Promise<void> {
  console.log('[Repair] Fixing RolePermission rows: organizations → accounts...');

  const result = await prisma.rolePermission.updateMany({
    where: { module: 'organizations' },
    data: { module: 'accounts' },
  });

  console.log(`[Repair] Updated ${result.count} RolePermission rows (organizations → accounts).`);

  if (result.count === 0) {
    console.log('[Repair] No rows needed updating (already correct or table is empty).');
  }
}

export async function backfillUserRoles(): Promise<void> {
  console.log('[Repair] Backfilling missing UserRole junction rows...');

  // Fetch all users — User.role is non-nullable (String with a default value)
  const users = await prisma.user.findMany({
    select: { id: true, tenantId: true, role: true },
  });

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.role) continue;

    // Find matching RoleDefinition within the same tenant — never cross-tenant
    const roleDef = await prisma.roleDefinition.findFirst({
      where: { tenantId: user.tenantId, name: user.role },
      select: { id: true, tenantId: true },
    });

    if (!roleDef) {
      // No matching RoleDefinition — skip; cannot create a cross-tenant assignment
      skipped++;
      continue;
    }

    // Safety check: ensure the RoleDefinition belongs to the same tenant as the user
    if (roleDef.tenantId !== user.tenantId) {
      console.warn(
        `[Repair] Skipping UserRole for user ${user.id}: ` +
        `RoleDefinition tenant ${roleDef.tenantId} !== user tenant ${user.tenantId}`,
      );
      skipped++;
      continue;
    }

    // Upsert UserRole — no-op if it already exists
    const existing = await prisma.userRole.findUnique({
      where: { userId_roleId_tenantId: { userId: user.id, roleId: roleDef.id, tenantId: user.tenantId } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.userRole.create({
      data: { userId: user.id, roleId: roleDef.id, tenantId: user.tenantId },
    });
    created++;
  }

  console.log(`[Repair] UserRole backfill: ${created} created, ${skipped} already existed or skipped.`);
}

/**
 * runRepairs — exported composite runner called from prisma/seed.ts.
 * Safe to call on every seed run — all operations are idempotent.
 * Does NOT call process.exit so it can run inside a larger seed script.
 */
export async function runRepairs(): Promise<void> {
  await repairRolePermissions();
  await backfillUserRoles();
  console.log('[Repair] Complete.');
}

async function main(): Promise<void> {
  try {
    await runRepairs();
  } catch (err) {
    console.error('[Repair] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run standalone only (not when imported by seed.ts or other scripts)
if (require.main === module) {
  main();
}