import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { StrongPasswordSchema } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { hashPassword } from '../../shared/helpers/crypto';
import { Role } from '../../shared/constants/roles';
import { seedSystemRoles } from './roles.seed';
import { seedDefaultPipeline } from './pipeline.seed';
import { tenantContext } from '../../core/tenant/tenant-context';

/** Non-destructive bootstrap: repeat runs preserve passwords, roles and CRM records. */
async function main() {
  const email = 'seeder@camxian.com';
  const slug = 'seeder-company';
  const existing = await prisma.user.findFirst({ where: { email }, include: { tenant: true } });
  if (existing) {
    if (existing.tenant.slug !== slug || existing.role !== Role.CLIENT_ADMIN || existing.status !== 'ACTIVE') {
      throw new Error('Seed identity already exists with different ownership or access. Resolve it through account administration.');
    }
    console.log(`Seed account already exists: ${email}. Password and data are unchanged.`);
    return;
  }
  if (process.env.NODE_ENV === 'production' && !process.env.SEEDER_PASSWORD) {
    throw new Error('Set SEEDER_PASSWORD explicitly when seeding production.');
  }
  const password = process.env.SEEDER_PASSWORD ?? `Cx1!${randomBytes(18).toString('base64url')}`;
  StrongPasswordSchema.parse(password);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    // Never take ownership of an existing workspace as a side effect of seeding.
    const occupied = await tx.tenant.findUnique({ where: { slug } });
    if (occupied) throw new Error('Seeder workspace already exists without the seed identity; no changes were made.');
    const tenant = await tx.tenant.create({ data: {
      name: 'Camxian Seeder Workspace', slug, status: 'ACTIVE',
    } });
    await seedSystemRoles(tenant.id, tx);
    const role = await tx.roleDefinition.findUniqueOrThrow({
      where: { tenantId_name: { tenantId: tenant.id, name: Role.CLIENT_ADMIN } },
    });
    const user = await tx.user.create({ data: {
      tenantId: tenant.id, email, firstName: 'Seeder', lastName: 'Admin',
      passwordHash, role: Role.CLIENT_ADMIN, status: 'ACTIVE',
      emailVerified: new Date(), mustChangePassword: true, } });
    await tx.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id } });
    await tx.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: user.id } });
    await tenantContext.run({ tenantId: tenant.id }, () => seedDefaultPipeline(tenant.id, tx));
  }, { timeout: 30000 });
  console.log(`Created ${email} (Client Admin). Change the temporary password on first login.`);
  if (!process.env.SEEDER_PASSWORD) console.log(`Temporary password: ${password}`);
}

main().catch(error => {
  console.error('Seed account setup failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
