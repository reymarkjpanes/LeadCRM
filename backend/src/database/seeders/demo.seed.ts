import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../shared/helpers/crypto';
import { seedSystemRoles } from './roles.seed';

const prisma = new PrismaClient();

/**
 * seedDemoAccounts — idempotent System Admin seeder.
 *
 * Upserts the leadcrm-system tenant and the single System Admin user whose
 * credentials are controlled entirely by env vars. Runs on every server boot
 * so the password hash in the DB always matches SYSTEM_ADMIN_PASSWORD from
 * the current environment — the only reliable repair mechanism on Render's
 * free plan (no shell access, no post-deploy hooks).
 *
 * All other tenant and user accounts are created through the normal user
 * registration workflow. This seeder is intentionally narrow — one tenant,
 * one user, zero demo data.
 *
 * SECURITY: In production, SYSTEM_ADMIN_PASSWORD must be set to a strong
 * value in the deployment platform's secret config (e.g. Render dashboard).
 * The seeder refuses to run with the default 'admin123' password in
 * production to prevent accidental weak-credential deployment.
 *
 * Returns the seeded System Admin email for startup log confirmation.
 */
export async function seedDemoAccounts(): Promise<string> {
  const systemAdminEmail    = (process.env.SYSTEM_ADMIN_EMAIL ?? 'admin@leadcrm.io').toLowerCase().trim();
  const systemAdminPassword = process.env.SYSTEM_ADMIN_PASSWORD ?? 'admin123';

  if (process.env.NODE_ENV === 'production' && systemAdminPassword === 'admin123') {
    throw new Error(
      '[Seed] SECURITY: SYSTEM_ADMIN_PASSWORD must be set to a strong password in production. ' +
      'Set it in your deployment platform\'s environment configuration (e.g. Render dashboard). ' +
      'Do NOT use the default admin123 password in production.',
    );
  }

  // Upsert the canonical system tenant. Using 'ACTIVE' + 'ENTERPRISE' ensures
  // the System Admin bypasses any subscription gate checks on the backend.
  const systemTenant = await prisma.tenant.upsert({
    where:  { slug: 'leadcrm-system' },
    update: {
      status:               'ACTIVE',
      subscriptionStatus:   'ACTIVE',
      onboardingStep:       3,
      onboardingCompletedAt: new Date(),
    },
    create: {
      name:                 'LeadCRM System',
      slug:                 'leadcrm-system',
      status:               'ACTIVE',
      subscriptionStatus:   'ACTIVE',
      plan:                 'ENTERPRISE',
      onboardingStep:       3,
      onboardingCompletedAt: new Date(),
    },
  });

  // Seed system roles for the system tenant (idempotent).
  await seedSystemRoles(systemTenant.id);

  const passwordHash = await hashPassword(systemAdminPassword);

  // Upsert the System Admin user. The update block always restores the correct
  // password hash, ACTIVE status, verified email, and role so a re-deploy
  // automatically repairs a stale or broken account without manual DB access.
  await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: systemTenant.id, email: systemAdminEmail } },
    update: {
      passwordHash,
      status:        'ACTIVE',
      role:          'System Admin',
      emailVerified: new Date(),
    },
    create: {
      tenantId:      systemTenant.id,
      email:         systemAdminEmail,
      firstName:     'System',
      lastName:      'Admin',
      passwordHash,
      role:          'System Admin',
      status:        'ACTIVE',
      emailVerified: new Date(),
    },
  });

  console.log(`[Seed] ✓ System Admin: ${systemAdminEmail}`);
  return systemAdminEmail;
}

// ── Standalone runner ─────────────────────────────────────────────────────
if (require.main === module) {
  seedDemoAccounts()
    .catch((err) => { console.error('[Seed] Error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
