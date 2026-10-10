import 'dotenv/config';
import assert from 'node:assert/strict';
import prisma from '../config/database.config';

async function main() {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: 'seeder@camxian.com', tenant: { slug: 'seeder-company' } },
    include: { tenant: true, userRoles: { include: { role: true } } },
  });
  assert.equal(user.role, 'Client Admin');
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.tenant.status, 'ACTIVE');
  assert.equal(user.tenant.ownerUserId, user.id);
  assert.ok(user.passwordHash && user.emailVerified);
  assert.ok(user.userRoles.some(assignment => assignment.role.name === 'Client Admin' && !assignment.role.isArchived));
  assert.equal(await prisma.pipeline.count({ where: { tenantId: user.tenantId, isDefault: true, isArchived: false } }), 1);
  console.log(`Verified ${user.email}: Client Admin, tenant owner; first-login password change: ${user.mustChangePassword}. Default pipeline exists.`);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
