import prisma from '../../config/database.config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantPlanData {
  plan: string | null;      // PlanType enum value: STARTER | PRO | ENTERPRISE, or null when unsubscribed
  subscriptionStatus: string; // SubscriptionStatus enum value
  tenantStatus: string;     // TenantStatus: SANDBOX | ACTIVE | SUSPENDED etc.
  maxUsers: number | null;
  maxContacts: number | null;
  maxDeals: number | null;
  features: string[];       // Feature keys enabled for this plan (from PlanFeature)
  additionalSeats: number;  // From active subscription
}

// ─── Sandbox defaults ─────────────────────────────────────────────────────────
// Limits enforced for SANDBOX/NONE (Free plan) tenants.
// Automation, workflows, and campaigns are blocked by planGate (require PRO/ENTERPRISE).
export const SANDBOX_MAX_CONTACTS = 100;
export const SANDBOX_MAX_USERS    = 3;

// ─── Cache Configuration ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: TenantPlanData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the plan data for a tenant, using an in-memory cache with 5-min TTL.
 * Returns plan type, subscription status, limits, and enabled feature keys.
 */
export async function getTenantPlanData(tenantId: string): Promise<TenantPlanData> {
  const now = Date.now();
  const cached = cache.get(tenantId);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const data = await fetchTenantPlanData(tenantId);

  cache.set(tenantId, { data, expiresAt: now + CACHE_TTL_MS });

  return data;
}

/**
 * Invalidate the plan cache for a specific tenant.
 * Call this after subscription changes (webhook handlers, upgrade/downgrade).
 */
export function invalidatePlanCache(tenantId: string): void {
  cache.delete(tenantId);
}

/**
 * Clear the entire plan cache. Used for testing or bulk operations.
 */
export function clearPlanCache(): void {
  cache.clear();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function fetchTenantPlanData(tenantId: string): Promise<TenantPlanData> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: true,
      subscriptionStatus: true,
      status: true,
      maxUsers: true,
      maxContacts: true,
      maxDeals: true,
    },
  });

  if (!tenant) {
    return {
      plan: null,
      subscriptionStatus: 'NONE',
      tenantStatus: 'SANDBOX',
      maxUsers: SANDBOX_MAX_USERS,
      maxContacts: SANDBOX_MAX_CONTACTS,
      maxDeals: null,
      features: [],
      additionalSeats: 0,
    };
  }

  // For SANDBOX/NONE tenants — apply Free plan defaults when limits aren't set yet.
  // These defaults are also set on the Tenant row at registration via registerGuest,
  // but this fallback ensures existing tenants created before that change also get limits.
  const isSandboxFree = tenant.status === 'SANDBOX' && tenant.subscriptionStatus === 'NONE';
  const maxUsers    = tenant.maxUsers    ?? (isSandboxFree ? SANDBOX_MAX_USERS    : null);
  const maxContacts = tenant.maxContacts ?? (isSandboxFree ? SANDBOX_MAX_CONTACTS : null);
  const maxDeals    = tenant.maxDeals    ?? null;

  // Fetch feature keys from PlanFeature for the tenant's current plan
  // plan may be null for unsubscribed tenants — skip feature lookup in that case
  const planRecord = tenant.plan
    ? await prisma.pricingPlan.findFirst({
        where: { planType: tenant.plan, isActive: true },
        select: {
          id: true,
          features: { select: { name: true, isEnabled: true } },
        },
      })
    : null;

  const features = planRecord?.features
    .filter((f: { isEnabled: boolean }) => f.isEnabled)
    .map((f: { name: string }) => f.name.toLowerCase().replace(/\s+/g, '_')) ?? [];

  // Fetch additional seats from active subscription
  let additionalSeats = 0;
  const activeSubscription = await prisma.subscription.findFirst({
    where: { tenantId, status: { in: ['ACTIVE'] } },
    select: { additionalSeats: true },
    orderBy: { createdAt: 'desc' },
  });
  additionalSeats = activeSubscription?.additionalSeats ?? 0;

  return {
    plan: tenant.plan ?? null,
    subscriptionStatus: tenant.subscriptionStatus,
    tenantStatus: tenant.status,
    maxUsers,
    maxContacts,
    maxDeals,
    features,
    additionalSeats,
  };
}
