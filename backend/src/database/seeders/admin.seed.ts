import { PrismaClient, Tenant } from '@prisma/client';
import { hashPassword } from '../../shared/helpers/crypto';

const prisma = new PrismaClient();

/**
 * Seeds the LeadCRM system admin tenant and user.
 * Credentials are read from environment variables — never hardcoded.
 *
 * Uses upsert with an update block so every re-run restores the correct
 * password hash, ACTIVE status, and role — even if a previous deploy left
 * the account in a stale or broken state. The old findFirst+create pattern
 * silently skipped the update when the row already existed, which meant the
 * password hash was never repaired after an env var change.
 *
 * Returns the system tenant for downstream seeders.
 */
export async function seedSystemAdmin(): Promise<Tenant | null> {
  const email    = process.env.SYSTEM_ADMIN_EMAIL;
  const password = process.env.SYSTEM_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('[Seed] SYSTEM_ADMIN_EMAIL or SYSTEM_ADMIN_PASSWORD not set — skipping admin seed');
    return null;
  }

  const tenant = await prisma.tenant.upsert({
    where:  { slug: 'leadcrm-system' },
    update: {
      status:             'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      onboardingStep:          3,
      onboardingCompletedAt:   new Date(),
    },
    create: {
      name:               'LeadCRM System',
      slug:               'leadcrm-system',
      status:             'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      plan:               'ENTERPRISE',
      onboardingStep:          3,
      onboardingCompletedAt:   new Date(),
    },
  });

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: tenant.id, email } },
    // update block always restores the correct password hash and ACTIVE status
    // so a re-run repairs a stale account without manual DB intervention.
    update: {
      passwordHash,
      status:        'ACTIVE',
      role:          'System Admin',
      emailVerified: new Date(),
    },
    create: {
      tenantId:      tenant.id,
      email,
      firstName:     'System',
      lastName:      'Admin',
      passwordHash,
      role:          'System Admin',
      status:        'ACTIVE',
      emailVerified: new Date(),
    },
  });
  console.log(`[Seed] ✓ System Admin: ${email}`);

  return tenant;
}
