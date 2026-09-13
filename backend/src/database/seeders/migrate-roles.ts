/**
 * migrate-roles.ts
 *
 * One-time data migration: aligns existing database records with the
 * 4-role model (User, Guest, Client Admin, System Admin).
 *
 * What this does:
 *   1. Renames User.role = 'Restricted User' → 'Guest' across all tenants
 *   2. Renames RoleDefinition.name = 'Restricted User' → 'Guest' (per tenant)
 *   3. Removes RoleDefinition rows named 'Admin' and 'Super User' (and their
 *      RolePermission and UserRole child rows first to satisfy FK constraints)
 *   4. Migrates User.role = 'Admin' → 'Client Admin' for any tenant users
 *      who were given the old 'Admin' role
 *   5. Migrates User.role = 'Super User' → 'Client Admin' for the same reason
 *
 * Safe to re-run — all operations are idempotent checks before acting.
 *
 * Run:
 *   npx ts-node src/database/seeders/migrate-roles.ts
 *
 * Or via npm script:
 *   npm --prefix backend run db:migrate-roles
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateRoles(): Promise<void> {
  console.log('[Migrate] Starting role data migration...\n');

  // ── 1. Rename User.role 'Restricted User' → 'Guest' ────────────────────────
  const restrictedUserResult = await prisma.user.updateMany({
    where: { role: 'Restricted User' },
    data:  { role: 'Guest' },
  });
  console.log(`[Migrate] User.role 'Restricted User' → 'Guest': ${restrictedUserResult.count} row(s) updated`);

  // ── 2. Rename User.role 'Admin' → 'Client Admin' ────────────────────────────
  // These were tenant-level admins assigned the old 'Admin' role string.
  // System Admin users are NOT touched (they have role = 'System Admin').
  const adminUserResult = await prisma.user.updateMany({
    where: { role: 'Admin' },
    data:  { role: 'Client Admin' },
  });
  console.log(`[Migrate] User.role 'Admin' → 'Client Admin': ${adminUserResult.count} row(s) updated`);

  // ── 3. Rename User.role 'Super User' → 'Client Admin' ───────────────────────
  const superUserResult = await prisma.user.updateMany({
    where: { role: 'Super User' },
    data:  { role: 'Client Admin' },
  });
  console.log(`[Migrate] User.role 'Super User' → 'Client Admin': ${superUserResult.count} row(s) updated`);

  // ── 4. Rename RoleDefinition 'Restricted User' → 'Guest' per tenant ─────────
  // Must check for an existing 'Guest' RoleDefinition first to avoid unique
  // constraint violations (tenantId + name must be unique).
  const restrictedRoleDefs = await prisma.roleDefinition.findMany({
    where: { name: 'Restricted User' },
    select: { id: true, tenantId: true },
  });
  console.log(`\n[Migrate] Found ${restrictedRoleDefs.length} 'Restricted User' RoleDefinition row(s)`);

  for (const roleDef of restrictedRoleDefs) {
    // Check whether a 'Guest' RoleDefinition already exists for this tenant
    const existingGuest = await prisma.roleDefinition.findUnique({
      where: { tenantId_name: { tenantId: roleDef.tenantId, name: 'Guest' } },
    });

    if (existingGuest) {
      // A 'Guest' row already exists — re-point UserRole rows then delete the duplicate
      console.log(`  [Migrate] Tenant ${roleDef.tenantId}: 'Guest' already exists, re-pointing UserRole rows...`);
      await prisma.userRole.updateMany({
        where: { roleId: roleDef.id, tenantId: roleDef.tenantId },
        data:  { roleId: existingGuest.id },
      });
      // Delete orphaned RolePermission rows
      await prisma.rolePermission.deleteMany({ where: { roleId: roleDef.id } });
      // Delete the stale 'Restricted User' row
      await prisma.roleDefinition.delete({ where: { id: roleDef.id } });
      console.log(`  [Migrate] Tenant ${roleDef.tenantId}: stale 'Restricted User' RoleDefinition removed`);
    } else {
      // Rename in-place
      await prisma.roleDefinition.update({
        where: { id: roleDef.id },
        data:  { name: 'Guest' },
      });
      console.log(`  [Migrate] Tenant ${roleDef.tenantId}: 'Restricted User' → 'Guest' renamed`);
    }
  }

  // ── 5. Remove RoleDefinition 'Admin' rows ───────────────────────────────────
  const adminRoleDefs = await prisma.roleDefinition.findMany({
    where: { name: 'Admin' },
    select: { id: true, tenantId: true },
  });
  console.log(`\n[Migrate] Found ${adminRoleDefs.length} 'Admin' RoleDefinition row(s) to remove`);

  for (const roleDef of adminRoleDefs) {
    // Re-point any UserRole rows to the Client Admin RoleDefinition
    const clientAdminDef = await prisma.roleDefinition.findUnique({
      where: { tenantId_name: { tenantId: roleDef.tenantId, name: 'Client Admin' } },
    });
    if (clientAdminDef) {
      const moved = await prisma.userRole.updateMany({
        where: { roleId: roleDef.id, tenantId: roleDef.tenantId },
        data:  { roleId: clientAdminDef.id },
      });
      if (moved.count > 0) {
        console.log(`  [Migrate] Tenant ${roleDef.tenantId}: moved ${moved.count} UserRole row(s) from 'Admin' → 'Client Admin'`);
      }
    }
    // Delete child RolePermission rows first
    await prisma.rolePermission.deleteMany({ where: { roleId: roleDef.id } });
    // Now delete the RoleDefinition itself
    await prisma.roleDefinition.delete({ where: { id: roleDef.id } });
    console.log(`  [Migrate] Tenant ${roleDef.tenantId}: 'Admin' RoleDefinition removed`);
  }

  // ── 6. Remove RoleDefinition 'Super User' rows ──────────────────────────────
  const superUserRoleDefs = await prisma.roleDefinition.findMany({
    where: { name: 'Super User' },
    select: { id: true, tenantId: true },
  });
  console.log(`\n[Migrate] Found ${superUserRoleDefs.length} 'Super User' RoleDefinition row(s) to remove`);

  for (const roleDef of superUserRoleDefs) {
    // Re-point any UserRole rows to Client Admin
    const clientAdminDef = await prisma.roleDefinition.findUnique({
      where: { tenantId_name: { tenantId: roleDef.tenantId, name: 'Client Admin' } },
    });
    if (clientAdminDef) {
      const moved = await prisma.userRole.updateMany({
        where: { roleId: roleDef.id, tenantId: roleDef.tenantId },
        data:  { roleId: clientAdminDef.id },
      });
      if (moved.count > 0) {
        console.log(`  [Migrate] Tenant ${roleDef.tenantId}: moved ${moved.count} UserRole row(s) from 'Super User' → 'Client Admin'`);
      }
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: roleDef.id } });
    await prisma.roleDefinition.delete({ where: { id: roleDef.id } });
    console.log(`  [Migrate] Tenant ${roleDef.tenantId}: 'Super User' RoleDefinition removed`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n[Migrate] ✅ Role migration complete.');
  console.log('[Migrate] Final role distribution in User table:');
  const roleCounts = await prisma.$queryRaw<{ role: string; count: bigint }[]>`
    SELECT role, COUNT(*) AS count FROM "User" GROUP BY role ORDER BY count DESC
  `;
  for (const row of roleCounts) {
    console.log(`  ${row.role}: ${row.count}`);
  }
}

migrateRoles()
  .catch((err) => {
    console.error('[Migrate] ❌ Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
