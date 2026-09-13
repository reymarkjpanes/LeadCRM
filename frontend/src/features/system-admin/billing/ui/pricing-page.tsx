'use client';
import { cn } from '@/lib/utils';
import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Server, Users } from 'lucide-react';
import { pricingApiService } from '../services/pricing.service';
import type { PricingPlanDto } from '@leadcrm/shared';

// ── Local UI plan shape ───────────────────────────────────────────────────────

export interface UiPlanFeature {
  id:      string;
  text:    string;
  enabled: boolean;
}

export interface UiPlan {
  id:             string;
  name:           string;
  price:          number;
  usersLimit:     string;
  storage:        string;
  features:       UiPlanFeature[];
  paymentMethods: PricingPlanDto['paymentMethods'];
  isPopular:      boolean;
  // -- Stripe linkage (null until an existing product/price is attached) --------
  stripeProductId:        string | null;
  stripeMonthlyPriceId:   string | null;
  stripeQuarterlyPriceId: string | null;
  stripeAnnualPriceId:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maxUsersLabel(maxUsers: number | null): string {
  if (maxUsers === null || maxUsers === 0) return 'Unlimited';
  return String(maxUsers);
}

function storageLimitLabel(storageMb: number | null): string {
  if (storageMb === null || storageMb === 0) return 'Unlimited';
  if (storageMb >= 1024) return `${Math.round(storageMb / 1024)}GB`;
  return `${storageMb}MB`;
}

/** Map API DTO → UiPlan. Middle plan (index 1) gets "Most Popular" badge. */
export function apiPlanToUi(plan: PricingPlanDto, index: number): UiPlan {
  return {
    id:         plan.id,
    name:       plan.name,
    price:      plan.monthlyPrice,
    usersLimit: maxUsersLabel(plan.maxUsers),
    storage:    storageLimitLabel(plan.storageLimit),
    features:   plan.features.map((f) => ({
      id:      f.id,
      text:    f.name,
      enabled: f.enabled,
    })),
    paymentMethods: plan.paymentMethods,
    isPopular:  index === 1,
    stripeProductId:        plan.stripeProductId,
    stripeMonthlyPriceId:   plan.stripeMonthlyPriceId,
    stripeQuarterlyPriceId: plan.stripeQuarterlyPriceId,
    stripeAnnualPriceId:    plan.stripeAnnualPriceId,
  };
}

// ── Fallback static data ──────────────────────────────────────────────────────

const FALLBACK_PLANS: UiPlan[] = [
  {
    id: 'starter', name: 'Starter', price: 1350,
    usersLimit: '5', storage: '10GB',
    features: [
      { id: 'f1', text: 'Basic Contact Tracking', enabled: true },
      { id: 'f2', text: 'Standard Support',       enabled: true },
    ],
    paymentMethods: [],
    isPopular: false,
    stripeProductId: null, stripeMonthlyPriceId: null, stripeQuarterlyPriceId: null, stripeAnnualPriceId: null,
  },
  {
    id: 'professional', name: 'Professional', price: 3600,
    usersLimit: '20', storage: '50GB',
    features: [
      { id: 'f1', text: 'Advanced Contact Tracking', enabled: true },
      { id: 'f2', text: 'Priority Support',           enabled: true },
      { id: 'f3', text: 'Custom Workflows',           enabled: true },
    ],
    paymentMethods: [],
    isPopular: true,
    stripeProductId: null, stripeMonthlyPriceId: null, stripeQuarterlyPriceId: null, stripeAnnualPriceId: null,
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 8950,
    usersLimit: 'Unlimited', storage: '500GB',
    features: [
      { id: 'f1', text: 'Custom Contact Tracking',   enabled: true },
      { id: 'f2', text: '24/7 Dedicated Support',    enabled: true },
      { id: 'f3', text: 'Advanced Custom Workflows', enabled: true },
    ],
    paymentMethods: [],
    isPopular: false,
    stripeProductId: null, stripeMonthlyPriceId: null, stripeQuarterlyPriceId: null, stripeAnnualPriceId: null,
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type BillingView = 'Monthly' | 'Quarterly' | 'Annual';

interface PricingPageProps {
  /** Called when the admin clicks Edit Plan — passes the plan to edit */
  onEditPlan: (plan: UiPlan, planIndex: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * System Admin — Pricing page.
 * Displays the three plan cards. "Edit Plan" triggers the full-page editor
 * via the onEditPlan callback — no drawer is opened here.
 */
export default function PricingPage({ onEditPlan }: PricingPageProps) {
  const [pricingView, setPricingView] = useState<BillingView>('Monthly');
  const [plans, setPlans] = useState<UiPlan[]>(FALLBACK_PLANS);
  const [isLoading, setIsLoading] = useState(true);

  // ── Load plans ────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await pricingApiService.getPlans();
      if (response.success && Array.isArray(response.data) && response.data.length > 0) {
        setPlans(response.data.map(apiPlanToUi));
      }
    } catch {
      // Backend unreachable — keep fallback data silently
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  // ── Accept update from the editor after save ──────────────────────────────
  // Exposed via ref so admin-console can call it without prop drilling.
  // We also export a setter forwarder that AdminConsole can wire up.
  // The actual update happens when AdminConsole calls back via onEditorSaved.

  const getDisplayPrice = (base: number): number => {
    if (pricingView === 'Quarterly') return Math.round(base * 3 * 0.9);
    if (pricingView === 'Annual')    return Math.round(base * 12 * 0.8);
    return base;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Pricing
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage subscription tiers and features
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 bg-amber-500/10 inline-block px-2 py-1 rounded border border-amber-500/20">
            Note: Maximum of 3 active plans supported.
          </p>
        </div>
        <div
          role="group"
          aria-label="Select billing cycle"
          className="inline-flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] shrink-0"
        >
          {(['Monthly', 'Quarterly', 'Annual'] as BillingView[]).map((v) => (
            <button
              key={v}
              onClick={() => setPricingView(v)}
              aria-pressed={pricingView === v}
              className={cn(
                'px-3 h-7 rounded-lg text-xs font-semibold transition-colors active:scale-95',
                pricingView === v
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className="relative rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] p-6 flex flex-col animate-pulse"
              >
                <div className="h-5 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-3" />
                <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-6" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded" />
                  <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded" />
                  <div className="h-4 w-5/6 bg-slate-200 dark:bg-slate-700 rounded" />
                </div>
                <div className="h-9 w-full bg-slate-200 dark:bg-slate-700 rounded-xl mt-4" />
              </div>
            ))
          : plans.map((plan, planIndex) => (
              <div
                key={plan.id}
                className={cn(
                  'relative rounded-2xl border bg-white dark:bg-white/[0.02] backdrop-blur-xl p-6 flex flex-col transition-shadow',
                  plan.isPopular
                    ? 'border-blue-500 shadow-lg shadow-blue-500/10'
                    : 'border-gray-200 dark:border-white/[0.05] shadow-lg hover:shadow-xl',
                )}
              >
                {plan.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase">
                    Most Popular
                  </div>
                )}
                <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{plan.name}</h4>
                <div className="text-3xl font-extrabold text-slate-900 dark:text-white mb-4">
                  ₱{getDisplayPrice(plan.price).toLocaleString()}
                  <span className="text-sm font-normal text-slate-500"> / {pricingView.toLowerCase()}</span>
                </div>
                <div className="space-y-3 mb-8 flex-1">
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Users size={16} /> {plan.usersLimit} Users
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Server size={16} /> {plan.storage} Storage
                  </div>
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wider">
                      Features
                    </p>
                    {plan.features.map((f) => (
                      <div key={f.id} className="flex items-start gap-2 mb-2">
                        <CheckCircle2
                          size={16}
                          className={f.enabled ? 'text-blue-500 shrink-0' : 'text-slate-400 shrink-0'}
                        />
                        <span
                          className={`text-sm ${
                            f.enabled ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 line-through'
                          }`}
                        >
                          {f.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => onEditPlan(plan, planIndex)}
                  className={cn(
                    'w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95',
                    plan.isPopular
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                      : 'bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.08] text-slate-900 dark:text-white',
                  )}
                >
                  Edit Plan
                </button>
              </div>
            ))}
      </div>
    </div>
  );
}
