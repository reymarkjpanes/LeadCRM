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

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting database seed...');
  console.log(`[Seed] NODE_ENV=${process.env.NODE_ENV ?? 'development'}`);

  // 0. Data repairs — idempotent, safe on every run.
  //    Fixes any legacy 'organizations' RolePermission rows and backfills
  //    missing UserRole junction records without requiring a separate manual step.
  await runRepairs();

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
