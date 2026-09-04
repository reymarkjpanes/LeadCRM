'use client';

import React, { useMemo } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useBillingData } from '../../billing/hooks/use-billing-data';

// ── Plan Feature Catalog (static marketing copy — NOT the source of truth for the user's plan) ──
// The actual current plan is read from the billing API via useBillingData().

interface PlanInfo {
  name: string;
  planType: string;
  features: string[];
}

const PLAN_INFO: Record<string, PlanInfo> = {
  FREE: {
    name: 'Free',
    planType: 'FREE',
    features: [
      'Basic CRM (Leads, Contacts, Deals)',
      'Up to 3 team members',
      '1,000 contacts limit',
      'Community support',
    ],
  },
  PRO: {
    name: 'Professional',
    planType: 'PRO',
    features: [
      'Everything in Free',
      'Workflow Automation',
      'Advanced Reporting & Export',
      'Up to 15 team members',
      '25,000 contacts limit',
      'Priority email support',
      'API access',
    ],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    planType: 'ENTERPRISE',
    features: [
      'Everything in Pro',
      'Marketing Campaigns',
      'Unlimited team members',
      'Unlimited contacts',
      'Custom fields & modules',
      'Dedicated account manager',
      'SSO & advanced security',
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBillingCycle(cycle: string | undefined): string {
  if (!cycle) return '';
  return cycle.charAt(0) + cycle.slice(1).toLowerCase();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Plan & Usage tab for the Settings page.
 *
 * Shows the tenant's actual current plan from the billing API.
 * All billing operations (subscribe, upgrade, downgrade, manage payment, seats)
 * happen on the dedicated /billing/client page via Stripe.
 *
 * Pattern:
 *   Settings = read-only summary of current state
 *   Billing  = all money/subscription operations
 */
export function PlanUsageTab(): React.ReactElement {
  const router = useRouter();
  const { subscription, isLoading, error } = useBillingData();

  // Derive display values from the live subscription — never from hardcoded PLAN_INFO
  const planName = subscription?.plan?.name ?? (isLoading ? '' : 'Free');
  const planType = subscription?.plan?.planType ?? (isLoading ? '' : 'FREE');
  const billingCycle = subscription ? formatBillingCycle(subscription.billingCycle) : null;
  const nextBillingDate = formatDate(subscription?.nextBillingDate);
  const statusLabel = subscription?.status
    ? subscription.status.charAt(0) + subscription.status.slice(1).toLowerCase()
    : 'No active plan';

  // Match the active plan type to the feature list for display
  const currentPlanFeatures = useMemo(
    () => PLAN_INFO[planType]?.features ?? PLAN_INFO.FREE.features,
    [planType],
  );

  return (
    <div className="space-y-8">
      {/* ── Error state ─────────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-500/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">
            Unable to load billing data. <button type="button" onClick={() => router.push('/billing/client')} className="underline cursor-pointer">View billing portal</button>
          </p>
        </div>
      )}

      {/* ── Current Plan + SMS Info (side by side) ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

        {/* Current Plan Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-6 shadow-sm"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                <CreditCard className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Current Plan
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your active subscription details.
                </p>
              </div>
            </div>
          </div>

          {/* Plan details — skeleton while loading */}
          {isLoading ? (
            <div className="space-y-3 mb-6">
              <div className="h-7 w-32 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
              <div className="h-4 w-48 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 w-40 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
          ) : (
            <div className="mb-6 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                  {planName || 'Free'}
                </span>
                {subscription?.status && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                    subscription.status === 'ACTIVE'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40'
                      : subscription.status === 'TRIAL'
                      ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700/40'
                      : subscription.status === 'PAST_DUE'
                      ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {statusLabel}
                  </span>
                )}
              </div>
              {billingCycle && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {billingCycle} billing
                  {subscription?.nextBillingDate && (
                    <> &middot; Renews <span className="font-medium text-slate-700 dark:text-slate-300">{nextBillingDate}</span></>
                  )}
                </p>
              )}
              {!subscription && !isLoading && (
                <p className="text-sm text-slate-500 dark:text-slate-400">No active subscription.</p>
              )}
              {/* Feature highlights for the current plan */}
              {currentPlanFeatures.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {currentPlanFeatures.slice(0, 3).map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* CTA */}
          <div className="mt-auto pt-5 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => router.push('/billing/client')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              Manage Billing &amp; Subscription
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Upgrade, downgrade, manage payment methods, view invoices, and add seats.
            </p>
          </div>
        </motion.div>

        {/* SMS / Messaging Usage Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-6 shadow-sm"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">SMS Usage</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Messaging consumption this billing period.
                </p>
              </div>
            </div>
          </div>

          {/* Plan badge */}
          {!isLoading && (
            <div className="mb-5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                <Sparkles className="h-3 w-3" />
                {planName || 'Free'} plan
              </span>
            </div>
          )}
          {isLoading && (
            <div className="mb-5 h-6 w-28 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
          )}

          {/* SMS detail redirect — detailed usage lives on the billing portal */}
          <div className="mt-auto">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Detailed SMS usage, cost breakdowns, and messaging analytics are available in your billing portal.
            </p>
            <button
              type="button"
              onClick={() => router.push('/billing/client')}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors cursor-pointer"
            >
              View SMS details in billing portal
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      </div>

      {/* ── Plan Comparison (Read-Only) ────────────────────────────────────── */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Available Plans</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.values(PLAN_INFO).map((plan) => {
            const isCurrentPlan = !isLoading && plan.planType === planType;
            return (
              <div
                key={plan.planType}
                className={`rounded-xl border bg-white dark:bg-slate-900 p-5 transition-colors ${
                  isCurrentPlan
                    ? 'border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-200 dark:ring-indigo-800'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-slate-400" />
                    <h5 className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</h5>
                  </div>
                  {isCurrentPlan && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700/40">
                      Current
                    </span>
                  )}
                  {isLoading && (
                    <div className="h-4 w-12 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
                  )}
                </div>
                <ul className="space-y-1.5">
                  {plan.features.slice(0, 4).map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {plan.features.length > 4 && (
                    <li className="text-xs text-slate-400 dark:text-slate-500 pl-4.5">
                      +{plan.features.length - 4} more features
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  onClick={() => router.push('/billing/client')}
                  className="mt-4 w-full text-center text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors cursor-pointer"
                >
                  {isCurrentPlan ? 'Manage plan →' : 'View on Billing Page →'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default PlanUsageTab;
