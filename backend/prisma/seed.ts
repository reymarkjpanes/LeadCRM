/**
 * prisma/seed.ts — LeadCRM database seed entry point.
 *
 * Runs via:  npx prisma db seed  (configured in package.json "prisma.seed")
 * Or:        npm run db:seed
 *
 * Safe to run multiple times — all operations use upsert.
 * Uses DATABASE_URL from the environment — works for both local and Render/production.
 *
 * Seed order:
 *   1. Demo accounts (system admin + client tenant users) — always runs
 *   2. Realistic multi-tenant data (development only — skipped in production)
 */
import { PrismaClient } from '@prisma/client';
import { seedDemoAccounts } from '../src/database/seeders/demo.seed';
import { seedPricingPlans } from '../src/database/seeders/pricing-plans.seed';
import { generateTenants } from '../src/database/seeders/tenant-generator';
import { runRepairs } from '../src/database/scripts/repair-role-permissions';
import { encryptToken } from '../src/core/encryption/crypto.service';

const prisma = new PrismaClient();

/**
 * Seeds the system Gmail sender EmailAccount used by email.service.ts Transport 1.
 * Only runs when GMAIL_SYSTEM_SENDER_REFRESH_TOKEN is set — skips silently otherwise.
 * Uses upsert so it's safe on every deploy.
 */
async function seedGmailSystemSender(): Promise<void> {
  const gmailEmail   = process.env.GMAIL_SYSTEM_SENDER_GMAIL_EMAIL;
  const accessToken  = process.env.GMAIL_SYSTEM_SENDER_ACCESS_TOKEN;
  const refreshToken = process.env.GMAIL_SYSTEM_SENDER_REFRESH_TOKEN;
  const encKey       = process.env.ENCRYPTION_KEY;

  if (!gmailEmail || !refreshToken || !encKey) {
    // Not configured — skip silently. Gmail transport will fall back to Resend.
    return;
  }

  try {
    const expiresIn      = parseInt(process.env.GMAIL_SYSTEM_SENDER_EXPIRES_IN ?? '3599', 10);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // accessToken may be expired — that's fine. getSystemAccessToken() auto-refreshes
    // using the refresh token. Store a placeholder if missing.
    const rawAccessToken         = accessToken ?? 'placeholder-will-be-refreshed';
    const encryptedAccessToken   = encryptToken(rawAccessToken);
    const encryptedRefreshToken  = encryptToken(refreshToken);

    await prisma.emailAccount.upsert({
      where: {
        tenantId_userId_provider: { tenantId: 'system', userId: 'system', provider: 'gmail' },
      },
      update: {
        email:          gmailEmail,
        accessToken:    encryptedAccessToken,
        refreshToken:   encryptedRefreshToken,
        tokenExpiresAt,
        isActive:       true,
      },
      create: {
        tenantId:       'system',
        userId:         'system',
        provider:       'gmail',
        email:          gmailEmail,
        accessToken:    encryptedAccessToken,
        refreshToken:   encryptedRefreshToken,
        tokenExpiresAt,
        isActive:       true,
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/userinfo.email',
        ],
      },
    });
    console.log(`[Seed] ✓ Gmail system sender seeded for: ${gmailEmail}`);
  } catch (err: unknown) {
    // Non-blocking — seed proceeds even if Gmail setup fails
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[Seed] ⚠ Gmail system sender seed failed (non-blocking): ${message}`);
  }
}

async function main() {
  console.log('[Seed] Starting database seed...');
  console.log(`[Seed] NODE_ENV=${process.env.NODE_ENV ?? 'development'}`);

  // 0. Data repairs — idempotent, safe on every run.
  //    Fixes any legacy 'organizations' RolePermission rows and backfills
  //    missing UserRole junction records without requiring a separate manual step.
  await runRepairs();

  // 0b. Gmail system sender — seeds the EmailAccount row used by email.service.ts
  //     Only runs when GMAIL_SYSTEM_SENDER_REFRESH_TOKEN is set in the environment.
  //     Safe to run on every deploy — uses upsert.
  await seedGmailSystemSender();

  // 1. Demo accounts — idempotent upserts, safe on every deploy
  //    Creates: admin@gmail.com, super@leadcrm.com, admin@democorp.com,
  //             bob@democorp.com, guest@democorp.com
  await seedDemoAccounts();

  // 2. Pricing plans — idempotent, safe on every deploy
  await seedPricingPlans();

  // 3. Realistic multi-tenant sample data — development/staging only.
  //    Skip in production to avoid polluting real customer data.
  if (process.env.NODE_ENV !== 'production' && process.env.SKIP_DEMO_TENANTS !== 'true') {
    console.log('[Seed] Generating sample tenants (dev/staging only)...');
    await generateTenants(10);
  } else {
    console.log('[Seed] Skipping sample tenant generation (production or SKIP_DEMO_TENANTS=true).');
  }

  console.log('[Seed] Complete.');
}

main()
  .catch((e) => {
    console.error('[Seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
