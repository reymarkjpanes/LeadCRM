import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database.config';
import { getTenantPlanData } from '../../shared/utils/plan-cache';

// ─── Plan Tier Hierarchy ──────────────────────────────────────────────────────

const PLAN_TIER_ORDER: Record<string, number> = {
  STARTER: 0,
  PRO: 1,
  ENTERPRISE: 2,
};

// ─── Feature Minimum Tier Registry ────────────────────────────────────────────
// Maps feature keys to the minimum plan tier required.
// If a feature is not listed here, it's available on all plans.

const FEATURE_MINIMUM_TIER: Record<string, string> = {
  automation: 'PRO',
  workflows: 'PRO',
  bulk_export: 'PRO',
  advanced_reporting: 'PRO',
  marketing_campaigns: 'ENTERPRISE',
  api_access: 'PRO',
  custom_fields: 'PRO',
};

// ─── planGate Middleware Factory ──────────────────────────────────────────────

/**
 * planGate(featureKey) — Middleware that checks whether the tenant's current plan
 * includes access to a specific feature.
 *
 * Resolution order:
 *   1. Check PlanFeature override (explicit per-plan feature toggle)
 *   2. Fall back to FEATURE_MINIMUM_TIER hierarchy
 *
 * Returns 403 with code 'PLAN_UPGRADE_REQUIRED' if blocked.
 *
 * Usage:
 *   router.post('/workflows', authMiddleware, tenantMiddleware, planGate('workflows'), controller.create);
 */
export function planGate(featureKey: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.tenantId) {
      return next(); // No tenant context — let downstream auth handle it
    }

    try {
      const planData = await getTenantPlanData(req.user.tenantId);
      // plan is null for unsubscribed tenants — treat as tier 0 (no plan = Starter level)
      const planKey: string = planData.plan ?? '';
      const currentTier = PLAN_TIER_ORDER[planKey] ?? 0;

      // 1. Check explicit PlanFeature override
      const normalizedFeature = featureKey.toLowerCase().replace(/\s+/g, '_');
      if (planData.features.includes(normalizedFeature)) {
        return next(); // Explicitly enabled for this plan
      }

      // 2. Fall back to tier hierarchy
      const requiredPlan = FEATURE_MINIMUM_TIER[normalizedFeature];
      if (!requiredPlan) {
        return next(); // Feature not gated — available to all plans
      }

      const requiredTier = PLAN_TIER_ORDER[requiredPlan] ?? 0;
      if (currentTier >= requiredTier) {
        return next(); // Plan tier sufficient
      }

      // Blocked — insufficient plan
      _res.status(403).json({
        success: false,
        error: {
          code: 'PLAN_UPGRADE_REQUIRED',
          message: `This feature requires the ${requiredPlan} plan or higher.`,
          feature: featureKey,
          currentPlan: planData.plan,
          requiredPlan,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

// ─── recordLimitGate Middleware Factory ────────────────────────────────────────

/**
 * recordLimitGate(entityType) — Middleware that checks whether the tenant has
 * reached their record limit for the given entity type.
 *
 * Checks: current count vs (plan max + additional seats for users)
 * Returns 403 with code 'RECORD_LIMIT_REACHED' if at capacity.
 *
 * Usage:
 *   router.post('/leads', authMiddleware, tenantMiddleware, recordLimitGate('contacts'), controller.create);
 */
export function recordLimitGate(entityType: 'users' | 'contacts' | 'deals') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.tenantId) {
      return next();
    }

    try {
      const tenantId = req.user.tenantId;
      const planData = await getTenantPlanData(tenantId);

      let maxLimit: number | null = null;
      let currentCount = 0;

      switch (entityType) {
        case 'users': {
          // Users: plan max + additional purchased seats
          const baseMax = planData.maxUsers;
          if (!baseMax) return next(); // No limit configured
          maxLimit = baseMax + planData.additionalSeats;
          currentCount = await prisma.user.count({
            where: { tenantId, status: 'ACTIVE' },
          });
          break;
        }
        case 'contacts': {
          maxLimit = planData.maxContacts;
          if (!maxLimit) return next();
          // Count both leads and contacts (contacts table)
          currentCount = await prisma.lead.count({ where: { tenantId } });
          break;
        }
        case 'deals': {
          maxLimit = planData.maxDeals;
          if (!maxLimit) return next();
          currentCount = await prisma.deal.count({ where: { tenantId } });
          break;
        }
      }

      if (currentCount >= maxLimit) {
        const label = entityType.charAt(0).toUpperCase() + entityType.slice(1);
        _res.status(403).json({
          success: false,
          error: {
            code: 'RECORD_LIMIT_REACHED',
            message: `${label} limit reached for your current plan. Upgrade or add seats to continue.`,
            entityType,
            current: currentCount,
            max: maxLimit,
            plan: planData.plan,
          },
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// ─── Exports for testing / configuration ──────────────────────────────────────

export { PLAN_TIER_ORDER, FEATURE_MINIMUM_TIER };
