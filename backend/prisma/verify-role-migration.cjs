// Run only against a disposable local PostgreSQL database named role_migration_test.
// DATABASE_URL and DIRECT_URL must both point to that database.
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/role_migration_test' || process.env.DIRECT_URL !== url.href) {
  throw new Error('Use only the explicitly configured disposable local role_migration_test database');
}
const schema = path.join(__dirname, 'schema.prisma');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leadcrm-role-migration-'));
const before = path.join(tmp, 'before.prisma');
// The two defaults are the only Prisma datamodel changes in this migration.
fs.writeFileSync(before, fs.readFileSync(schema, 'utf8')
  .replace(/role          String\r?\n/, 'role          String @default("User")\n')
  .replace(/defaultRole            String\r?\n/, 'defaultRole            String @default("User")\n'));
const cli = require.resolve('prisma/build/index.js');
const run = args => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
const db = new PrismaClient();
async function main() {
  run(['db', 'push', '--schema', before, '--skip-generate']);
  const tenant = await db.tenant.create({ data: { name: 'Migration fixture', slug: `migration-${Date.now()}` } });
  const guest = await db.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Guest', isSystemRole: true } });
  const custom = await db.roleDefinition.create({ data: { tenantId: tenant.id, name: 'User', isSystemRole: true } });
  const permission = await db.rolePermission.create({ data: { tenantId: tenant.id, roleId: custom.id, module: 'contacts', canView: true } });
  const owner = await db.user.create({ data: { tenantId: tenant.id, firstName: 'Legacy', lastName: 'Owner', email: 'legacy@camxian.com', role: 'Guest' } });
  const staff = await db.user.create({ data: { tenantId: tenant.id, firstName: 'Staff', lastName: 'Member', email: 'staff@camxian.com', role: 'User' } });
  await db.userRole.createMany({ data: [{ userId: owner.id, tenantId: tenant.id, roleId: guest.id }, { userId: staff.id, tenantId: tenant.id, roleId: custom.id }] });
  await db.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: owner.id } });
  const session = await db.session.create({ data: { userId: owner.id, tenantId: tenant.id, tokenHash: `fixture-${Date.now()}`, expiresAt: new Date(Date.now() + 60000) } });
  // The historical migration revokes pending invitations. Build a minimal legacy
  // table here because the current Prisma model intentionally no longer exposes it.
  await db.$executeRawUnsafe('CREATE TABLE "TenantInvitation" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "email" TEXT NOT NULL, "roleId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "invitedById" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const invitationId = `legacy-invite-${Date.now()}`;
  await db.$executeRaw`INSERT INTO "TenantInvitation" ("id", "tenantId", "email", "roleId", "tokenHash", "invitedById", "expiresAt") VALUES (${invitationId}, ${tenant.id}, 'invite@camxian.com', ${guest.id}, ${`invite-${Date.now()}`}, ${owner.id}, ${new Date(Date.now() + 60000)})`;
  await db.tenantDomainSettings.create({ data: { tenantId: tenant.id, defaultRole: 'Guest' } });
  run(['db', 'execute', '--schema', schema, '--file', path.join(__dirname, 'migrations/20261001000000_retire_guest_role/migration.sql')]);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).status, 'INACTIVE');
  assert.equal((await db.roleDefinition.findUniqueOrThrow({ where: { id: guest.id } })).isArchived, true);
  assert.equal((await db.roleDefinition.findUniqueOrThrow({ where: { id: custom.id } })).isSystemRole, false);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).status, 'ACTIVE');
  assert.deepEqual(await db.rolePermission.findUniqueOrThrow({ where: { id: permission.id } }), permission);
  assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).ownerUserId, owner.id);
  assert.equal(await db.userRole.count({ where: { tenantId: tenant.id } }), 2);
  assert.ok((await db.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
  const [revokedInvitation] = await db.$queryRaw`SELECT "revokedAt" FROM "TenantInvitation" WHERE "id" = ${invitationId}`;
  assert.ok(revokedInvitation.revokedAt);
  assert.equal((await db.tenantDomainSettings.findUniqueOrThrow({ where: { tenantId: tenant.id } })).defaultRole, '');
  await assert.rejects(db.user.update({ where: { id: owner.id }, data: { status: 'ACTIVE' } }));
  await assert.rejects(db.roleDefinition.update({ where: { id: guest.id }, data: { isArchived: false } }));
  // Reassignment/restoration preserves the original identity and ownership.
  await db.user.update({ where: { id: owner.id }, data: { role: custom.name } });
  await db.user.update({ where: { id: owner.id }, data: { status: 'ACTIVE' } });
  run(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code']);
  console.log('PASS: migration applies, schema matches, grants/data preserved, retired access blocked.');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  await db.$disconnect();
  fs.unlinkSync(before);
  fs.rmdirSync(tmp);
});
