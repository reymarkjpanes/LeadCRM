import { PrismaClient, PlanType } from '@prisma/client';

const prisma = new PrismaClient();

interface PlanSeed {
  name:           string;
  planType:       PlanType;
  monthlyPrice:   number;
  quarterlyPrice: number;
  annualPrice:    number;
  maxUsers:       number | null;
  storageLimit:   number | null; // MB
  features:       string[];
}

const PLANS: PlanSeed[] = [
  {
    name:           'Starter',
    planType:       'STARTER',
    monthlyPrice:   1350,
    quarterlyPrice: 3645,   // 1350 * 3 * 0.90
    annualPrice:    12960,  // 1350 * 12 * 0.80
    maxUsers:       5,
    storageLimit:   10240,  // 10 GB in MB
    features: [
      'Basic Contact Tracking',
      'Standard Support',
    ],
  },
  {
    name:           'Professional',
    planType:       'PRO',
    monthlyPrice:   3600,
    quarterlyPrice: 9720,   // 3600 * 3 * 0.90
    annualPrice:    34560,  // 3600 * 12 * 0.80
    maxUsers:       20,
    storageLimit:   51200,  // 50 GB in MB
    features: [
      'Advanced Contact Tracking',
      'Priority Support',
      'Custom Workflows',
    ],
  },
  {
    name:           'Enterprise',
    planType:       'ENTERPRISE',
    monthlyPrice:   8950,
    quarterlyPrice: 24165,  // 8950 * 3 * 0.90
    annualPrice:    85920,  // 8950 * 12 * 0.80
    maxUsers:       null,   // Unlimited
    storageLimit:   512000, // 500 GB in MB
    features: [
      'Custom Contact Tracking',
      '24/7 Dedicated Support',
      'Advanced Custom Workflows',
    ],
  },
];

/**
 * seedPricingPlans — idempotent pricing plan seeder.
 *
 * Creates or updates the three canonical plans (Starter, Professional, Enterprise).
 * Uses upsert by name so it is safe to run multiple times.
 * Features are only created if they don't already exist for the plan to avoid
 * overwriting admin-edited feature lists after the first seed run.
 */
export async function seedPricingPlans(): Promise<void> {
  console.log('[Seed] Seeding pricing plans...');

  for (const planSeed of PLANS) {
    const plan = await prisma.pricingPlan.upsert({
      where:  { name: planSeed.name },
      update: {
        planType:       planSeed.planType,
        monthlyPrice:   planSeed.monthlyPrice,
        quarterlyPrice: planSeed.quarterlyPrice,
        annualPrice:    planSeed.annualPrice,
        maxUsers:       planSeed.maxUsers,
        storageLimit:   planSeed.storageLimit,
        isActive:       true,
      },
      create: {
        name:           planSeed.name,
        planType:       planSeed.planType,
        monthlyPrice:   planSeed.monthlyPrice,
        quarterlyPrice: planSeed.quarterlyPrice,
        annualPrice:    planSeed.annualPrice,
        maxUsers:       planSeed.maxUsers,
        storageLimit:   planSeed.storageLimit,
        isActive:       true,
      },
    });

    // Upsert features by name — idempotent, won't create duplicates on re-runs
    // and won't overwrite features that have been edited by an admin.
    const existingFeatures = await prisma.planFeature.findMany({
      where: { planId: plan.id },
      select: { name: true },
    });
    const existingNames = new Set(existingFeatures.map((f) => f.name));
    const newFeatures = planSeed.features.filter((name) => !existingNames.has(name));

    if (newFeatures.length > 0) {
      await prisma.planFeature.createMany({
        data: newFeatures.map((name) => ({
          planId:    plan.id,
          name,
          isEnabled: true,
        })),
      });
      console.log(`[Seed] ✓ ${planSeed.name}: created ${newFeatures.length} new feature(s)`);
    } else {
      console.log(`[Seed] ✓ ${planSeed.name}: all features already exist, skipping`);
    }
  }

  console.log('[Seed] Pricing plans seeded.');
}

// ── Standalone runner ─────────────────────────────────────────────────────────
if (require.main === module) {
  seedPricingPlans()
    .catch((err) => { console.error('[Seed] Error:', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
