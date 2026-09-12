'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/store/AuthContext';
import { CreditCard, Download, CheckCircle2, Sparkles, TrendingUp, ExternalLink, AlertTriangle, Loader2, XCircle, Check, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useBillingData } from '../hooks/use-billing-data';
import { billingService } from '../services/billing.service';
import { invoicesApi } from '@/shared/services/invoices.api';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { BackButton } from '@/shared/components/ui/back-button';
import { SeatManagementCard } from './seat-management-card';
import { getTenantCurrency, formatCurrency as formatTenantCurrency } from '@/shared/utils/currency';
import type { BillingCycle, PricingPlan } from '../types/billing.types';
import type { Invoice } from '@/store/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// formatCurrency is tenant-aware — defined inside the component using useMemo
// so it always reflects the tenant's configured currency (e.g. USD, EUR, PHP).
// The local formatDate, getCycleLabel, and getStatusBadge helpers remain pure.

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function getCycleLabel(cycle: string): string {
  switch (cycle) {
    case 'MONTHLY': return 'month';
    case 'QUARTERLY': return 'quarter';
    case 'ANNUAL': return 'year';
    default: return 'month';
  }
}

function getStatusBadge(status: string): { text: string; className: string } {
  switch (status) {
    case 'ACTIVE':
      return { text: 'Active', className: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60' };
    case 'TRIAL':
      return { text: 'Trial', className: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/60' };
    case 'PAST_DUE':
      return { text: 'Past Due', className: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60' };
    case 'CANCELLED':
      return { text: 'Cancelled', className: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/60' };
    default:
      return { text: status, className: 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700' };
  }
}

// Retry delays for post-payment activation polling (ms).
// Declared at module scope — never changes, no need to recreate per render.
const ACTIVATION_RETRY_DELAYS = [0, 1000, 2000, 4000, 6000] as const;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientBillingPage() {
  const { tenant, userCan, restoreSession } = useAuth();
  const { subscription, plans, seats, isLoading, error, refetch, refetchSeats } = useBillingData();
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'payment-methods'>('overview');

  // Tenant-aware currency formatter.
  // All monetary amounts on this page (subscription cost, invoice totals, plan prices)
  // must reflect the tenant's configured currency — never hardcode a symbol.
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);
  const formatCurrency = useCallback(
    (amount: number): string =>
      formatTenantCurrency(amount, tenantCurrency),
    [tenantCurrency],
  );

  // Plan selection modal state
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>('MONTHLY');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Cancel dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Portal loading state
  const [portalLoading, setPortalLoading] = useState(false);

  // Invoice state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesTotal, setInvoicesTotal] = useState(0);

  // Post-payment activation polling state
  const [activationPending, setActivationPending] = useState(false);
  const [activationStalled, setActivationStalled] = useState(false);

  // ─── Post-payment activation polling ────────────────────────────────────────
  // Stripe redirects back with ?session_id= after checkout.
  // The webhook fires asynchronously — we poll /auth/me with bounded exponential
  // backoff until tenant.status becomes ACTIVE, then clear the pending state.
  // The frontend is READ-ONLY here — it never activates the account itself.

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) return;

    // Clean the URL immediately — do not leave session_id in browser history
    window.history.replaceState({}, '', window.location.pathname);

    setActivationPending(true);
    setActivationStalled(false);

    let attempt = 0;
    let cancelled = false;

    const pollOnce = async (): Promise<void> => {
      // Read-only — GET /auth/me and GET /billing/subscription. Never activates.
      await restoreSession();
      await refetch();
    };

    const scheduleNext = (): void => {
      if (cancelled) return;
      if (attempt >= ACTIVATION_RETRY_DELAYS.length) {
        setActivationPending(false);
        setActivationStalled(true);
        return;
      }
      const delay = ACTIVATION_RETRY_DELAYS[attempt++];
      setTimeout(() => {
        if (cancelled) return;
        pollOnce().catch(() => {
          // Non-fatal — watcher below resolves when tenant.status updates
        });
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs once on mount — session_id detection is a one-time bootstrap

  // Watch for account activation — resolves pending state when the webhook fires.
  // Checks tenant.environment (set by AuthContext from tenantStatus) rather than
  // tenant.status directly, because the frontend Tenant type uses lowercase status values
  // while the backend returns uppercase ('ACTIVE'). environment is always correctly mapped.
  useEffect(() => {
    if (activationPending && tenant?.environment === 'production') {
      setActivationPending(false);
      setActivationStalled(false);
      toast.success('Your account is now active!');
      refetch();
    }
  }, [tenant?.environment, activationPending, refetch]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleUpgradePlan = useCallback(async (planId: string) => {
    try {
      setCheckoutLoading(true);

      // Determine if this is an upgrade, downgrade, or fresh checkout
      const PLAN_TIER: Record<string, number> = { STARTER: 0, PRO: 1, ENTERPRISE: 2 };
      const currentPlanType = subscription?.plan?.planType ?? 'STARTER';
      const targetPlan = plans.find((p) => p.id === planId);
      const currentTier = PLAN_TIER[currentPlanType] ?? 0;
      const targetTier = PLAN_TIER[targetPlan?.planType ?? 'STARTER'] ?? 0;

      if (!subscription) {
        // No subscription — use checkout flow
        const response = await billingService.createCheckoutSession(planId, selectedCycle);
        window.location.href = response.data.checkoutUrl;
        return;
      }

      if (targetTier > currentTier) {
        // Upgrade — immediate with proration
        const response = await billingService.upgradeSubscription(planId, selectedCycle);
        toast.success(`Upgraded to ${response.data.newPlan}! Changes are effective immediately.`);
        setShowPlanModal(false);
        refetch();
      } else if (targetTier < currentTier) {
        // Downgrade — scheduled at period end
        const response = await billingService.downgradeSubscription(planId, selectedCycle);
        toast.success(`Downgrade to ${response.data.pendingPlan} scheduled for ${formatDate(response.data.effectiveDate)}.`);
        setShowPlanModal(false);
        refetch();
      } else {
        // Same tier, different cycle — use checkout for plan change
        const response = await billingService.createCheckoutSession(planId, selectedCycle);
        window.location.href = response.data.checkoutUrl;
        return;
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'BILLING_NOT_CONFIGURED') {
        toast.error('Billing configuration is incomplete', {
          description: 'Stripe plan pricing is not yet configured. If you are an administrator, go to Admin → Billing → Sync Plans to Stripe to enable checkout.',
        });
        setShowPlanModal(false);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to change plan';
        toast.error(message);
      }
    } finally {
      setCheckoutLoading(false);
    }
  }, [selectedCycle, subscription, plans, refetch]);

  const handleCancelSubscription = useCallback(async () => {
    try {
      setCancelLoading(true);
      const response = await billingService.cancelSubscription();
      toast.success(`Subscription will cancel on ${formatDate(response.data.endsAt)}`);
      setShowCancelDialog(false);
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel subscription';
      toast.error(message);
    } finally {
      setCancelLoading(false);
    }
  }, [refetch]);

  const handleManagePaymentMethods = useCallback(async () => {
    try {
      setPortalLoading(true);
      const response = await billingService.createPortalSession();
      window.location.href = response.data.portalUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open payment portal';
      toast.error(message);
      setPortalLoading(false);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      setInvoicesLoading(true);
      const response = await invoicesApi.list({ page: 1, limit: 20 });
      setInvoices(response.data ?? []);
      setInvoicesTotal(response.meta?.total ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load invoices';
      toast.error(message);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  // Fetch invoices when history tab is selected
  useEffect(() => {
    if (activeTab === 'history') {
      fetchInvoices();
    }
  }, [activeTab, fetchInvoices]);

  // ─── Loading State ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8 max-w-[1200px] mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-xl w-64" />
          <div className="h-5 bg-slate-100 dark:bg-slate-800/50 rounded w-96" />
          <div className="h-12 bg-slate-100 dark:bg-slate-800/50 rounded-xl w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 h-64 bg-slate-100 dark:bg-slate-800/50 rounded-2xl" />
            <div className="h-64 bg-slate-100 dark:bg-slate-800/50 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
          <XCircle size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">Unable to load billing data</h2>
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-red-600 text-white rounded-xl font-medium text-sm hover:bg-red-700 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const statusBadge = subscription ? getStatusBadge(subscription.status) : getStatusBadge('NONE');
  const isCancelled = !!subscription?.cancelledAt;
  const isActive = subscription?.status === 'ACTIVE' || subscription?.status === 'TRIAL';

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1200px] mx-auto">
      {/* ─── Post-payment activation notices ─────────────────────────────── */}
      {activationPending && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl"
        >
          <div
            className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">
            Finalizing your account… Please wait.
          </p>
        </div>
      )}

      {activationStalled && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl"
        >
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
            Payment received. We&apos;re still confirming your subscription. Please refresh in a moment.
          </p>
          <button
            type="button"
            onClick={() => {
              setActivationStalled(false);
              setActivationPending(true);
              restoreSession()
                .then(() => refetch())
                .catch(() => {
                  setActivationPending(false);
                  setActivationStalled(true);
                });
            }}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors cursor-pointer"
          >
            Refresh Status
          </button>
        </div>
      )}

      {/* PAST_DUE Warning Banner */}
      {subscription?.status === 'PAST_DUE' && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-200">Payment failed</p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
              Your last payment was unsuccessful. Please update your payment method to keep your subscription active.
            </p>
            <button
              onClick={handleManagePaymentMethods}
              disabled={portalLoading}
              className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg font-medium text-xs hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {portalLoading ? 'Opening...' : 'Update Payment Method'}
            </button>
          </div>
        </div>
      )}

      {/* Back to Settings */}
      <BackButton label="Back to Settings" href="/settings?tab=plan" ariaLabel="Back to Settings" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Billing & Subscription</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Manage your plan, payment methods, and billing history.</p>
        </div>
        <div className="flex items-center gap-3">
          {userCan('billing', 'canView') && (
            <button
              onClick={() => setShowPlanModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
            >
              {subscription ? 'Change Plan' : 'Upgrade Plan'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'history', label: 'Billing History' },
          { id: 'payment-methods', label: 'Payment Methods' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-6 py-4 text-sm font-semibold transition-all relative cursor-pointer ${
              activeTab === tab.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeBillingTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {/* ─── Overview Tab ──────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {/* Current Plan Card */}
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Current Plan</h3>
                  <span className={`px-3 py-1 text-xs font-bold rounded-full border ${statusBadge.className}`}>
                    {subscription ? statusBadge.text : 'No plan'}
                  </span>
                </div>

                {subscription ? (
                  <>
                    <div className="flex items-end gap-2 mb-6">
                      <span className="text-4xl font-extrabold text-slate-900 dark:text-white">
                        {formatCurrency(subscription.amount)}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 mb-1">
                        / {getCycleLabel(subscription.billingCycle)}
                      </span>
                    </div>

                    {/* Plan limits */}
                    <div className="space-y-3 mb-6">
                      {subscription.plan.maxUsers && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={16} className="text-emerald-500" /> Up to {subscription.plan.maxUsers} Users
                        </div>
                      )}
                      {subscription.plan.storageLimit && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={16} className="text-emerald-500" /> {subscription.plan.storageLimit >= 1024 ? `${(subscription.plan.storageLimit / 1024).toFixed(0)}GB` : `${subscription.plan.storageLimit}MB`} Storage
                        </div>
                      )}
                      {subscription.plan.maxContacts && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={16} className="text-emerald-500" /> Up to {subscription.plan.maxContacts.toLocaleString()} Contacts
                        </div>
                      )}
                      {subscription.plan.maxDeals && (
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={16} className="text-emerald-500" /> Up to {subscription.plan.maxDeals.toLocaleString()} Deals
                        </div>
                      )}
                    </div>

                    {/* Cancellation notice */}
                    {isCancelled && (
                      <div className="mb-6 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          Subscription cancels on <strong>{formatDate(subscription.nextBillingDate)}</strong>. You'll retain access until then.
                        </p>
                      </div>
                    )}

                    <div className="pt-6 border-t border-slate-100 dark:border-slate-800 flex gap-3">
                      {isActive && !isCancelled && (
                        <button
                          onClick={() => setShowCancelDialog(true)}
                          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          Cancel Subscription
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-2">
                    <div className="flex items-end gap-2 mb-5">
                      <span className="text-4xl font-extrabold text-slate-900 dark:text-white">{formatCurrency(0)}</span>
                      <span className="text-slate-500 dark:text-slate-400 mb-1">/ month</span>
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                      You're currently on the <strong className="text-slate-900 dark:text-white">Free</strong> plan. Upgrade to unlock automation, advanced reporting, more team members, and higher limits.
                    </p>

                    {/* Free plan highlights */}
                    <div className="space-y-3 mb-6">
                      {[
                        'Basic CRM (Leads, Contacts, Deals)',
                        'Up to 3 team members',
                        '1,000 contacts limit',
                        'Community support',
                      ].map((feature) => (
                        <div key={feature} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> {feature}
                        </div>
                      ))}
                    </div>

                    <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                      <button
                        onClick={() => setShowPlanModal(true)}
                        className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
                      >
                        <Sparkles size={16} />
                        Upgrade to unlock more features
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Seat Management Card */}
              <SeatManagementCard
                seats={seats}
                hasSubscription={!!subscription}
                onSeatsChanged={refetchSeats}
              />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Next Payment Card */}
              {subscription && isActive && (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Next Payment</h3>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                    {subscription.nextBillingDate ? formatDate(subscription.nextBillingDate) : '—'}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Amount: {formatCurrency(subscription.amount)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <CreditCard size={16} className="text-slate-500 dark:text-slate-400" />
                    <span>Managed via Stripe</span>
                    <button
                      onClick={handleManagePaymentMethods}
                      disabled={portalLoading}
                      className="ml-auto text-blue-600 dark:text-blue-400 hover:underline text-xs font-medium cursor-pointer disabled:opacity-50"
                    >
                      {portalLoading ? '...' : 'Edit'}
                    </button>
                  </div>
                </div>
              )}

              {/* Plan Summary */}
              {subscription && (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Plan Details</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Plan</span>
                      <span className="font-medium text-slate-900 dark:text-white">{subscription.plan.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Billing Cycle</span>
                      <span className="font-medium text-slate-900 dark:text-white capitalize">{subscription.billingCycle.toLowerCase()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Started</span>
                      <span className="font-medium text-slate-900 dark:text-white">{formatDate(subscription.startDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Status</span>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full border ${statusBadge.className}`}>
                        {statusBadge.text}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Billing History Tab ───────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Invoice History</h3>
              {invoicesTotal > 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{invoicesTotal} invoice{invoicesTotal !== 1 ? 's' : ''} total</p>
              )}
            </div>

            {invoicesLoading ? (
              <div className="p-12 text-center">
                <Loader2 size={24} className="animate-spin text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading invoices...</p>
              </div>
            ) : invoices.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-slate-500 dark:text-slate-400">No invoices yet.</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Invoices will appear here after your first payment.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600 dark:text-slate-400">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-6 py-4 font-medium">Invoice</th>
                      <th className="px-6 py-4 font-medium">Date</th>
                      <th className="px-6 py-4 font-medium">Amount</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {invoices.map((inv) => {
                      const invStatusBadge = inv.paymentStatus === 'Paid'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60'
                        : inv.paymentStatus === 'Overdue'
                          ? 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border-red-200 dark:border-red-800/60'
                          : 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60';

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-blue-600 dark:text-blue-400 text-xs">
                            {inv.id.slice(0, 12)}
                          </td>
                          <td className="px-6 py-4 text-slate-900 dark:text-white">
                            {formatDate(inv.nextBillingDate ?? inv.createdAt)}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                            {formatCurrency(inv.amount ?? 0)}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${invStatusBadge}`}>
                              {inv.paymentStatus ?? 'Unpaid'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => toast.info(`Invoice ${inv.id.slice(0, 8)} — download coming soon`)}
                              className="text-slate-600 dark:text-slate-400 hover:text-blue-600 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download size={14} /> Download
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Payment Methods Tab ───────────────────────────────────────── */}
        {activeTab === 'payment-methods' && (
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Payment Methods</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Payment methods are managed securely through Stripe.
              </p>
            </div>
            <div className="p-8 text-center space-y-4">
              <CreditCard size={48} className="text-slate-300 dark:text-slate-600 mx-auto" />
              <div>
                <p className="text-slate-600 dark:text-slate-300 font-medium">
                  Manage your cards, bank accounts, and billing details on Stripe's secure portal.
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                  You can add, remove, or update payment methods at any time.
                </p>
              </div>
              <button
                onClick={handleManagePaymentMethods}
                disabled={portalLoading}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                {portalLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ExternalLink size={16} />
                )}
                {portalLoading ? 'Opening Stripe...' : 'Manage Payment Methods'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Plan Selection Modal ──────────────────────────────────────────── */}
      {showPlanModal && (
        <PlanSelectionModal
          plans={plans}
          currentPlanId={subscription?.plan.id ?? null}
          selectedCycle={selectedCycle}
          onCycleChange={setSelectedCycle}
          onSelect={handleUpgradePlan}
          onClose={() => setShowPlanModal(false)}
          loading={checkoutLoading}
        />
      )}

      {/* ─── Cancel Confirmation Dialog ────────────────────────────────────── */}
      {showCancelDialog && subscription && (
        <CancelConfirmationDialog
          endsAt={subscription.nextBillingDate}
          onConfirm={handleCancelSubscription}
          onCancel={() => setShowCancelDialog(false)}
          loading={cancelLoading}
        />
      )}
    </div>
  );
}

// ─── Plan Selection Modal ─────────────────────────────────────────────────────

interface PlanSelectionModalProps {
  plans: PricingPlan[];
  currentPlanId: string | null;
  selectedCycle: BillingCycle;
  onCycleChange: (cycle: BillingCycle) => void;
  onSelect: (planId: string) => void;
  onClose: () => void;
  loading: boolean;
}

// Savings calculated from DB prices — never hardcoded
function getQuarterlySavings(plan: PricingPlan): number {
  if (!plan.monthlyPrice) return 0;
  return Math.round((1 - plan.quarterlyPrice / (plan.monthlyPrice * 3)) * 100);
}

function getAnnualSavings(plan: PricingPlan): number {
  if (!plan.monthlyPrice) return 0;
  return Math.round((1 - plan.annualPrice / (plan.monthlyPrice * 12)) * 100);
}

function getPriceForCycle(plan: PricingPlan, cycle: BillingCycle): number {
  switch (cycle) {
    case 'MONTHLY':   return plan.monthlyPrice;
    case 'QUARTERLY': return plan.quarterlyPrice;
    case 'ANNUAL':    return plan.annualPrice;
  }
}

// Cycle label for CTA — must match exactly, never show annual/quarterly prices as "/month"
const CYCLE_CTA_LABELS: Record<BillingCycle, string> = {
  MONTHLY:   '/month',
  QUARTERLY: '/3 months',
  ANNUAL:    '/year',
};

function PlanSelectionModal({
  plans,
  currentPlanId,
  selectedCycle,
  onCycleChange,
  onSelect,
  onClose,
  loading,
}: PlanSelectionModalProps) {
  const [selectedPlanId, setSelectedPlanId] = React.useState<string | null>(null);

  // Tenant-aware currency for plan prices — this modal is a separate component
  // so it must derive currency independently rather than via closure.
  const { tenant } = useAuth();
  const tenantCurrency = React.useMemo(() => getTenantCurrency(tenant), [tenant]);
  const formatCurrency = React.useCallback(
    (amount: number) => formatTenantCurrency(amount, tenantCurrency),
    [tenantCurrency],
  );

  const activePlan = selectedPlanId
    ? plans.find((p) => p.id === selectedPlanId) ?? null
    : null;

  const handleSelect = (planId: string) => {
    setSelectedPlanId(planId);
  };

  const handleConfirm = () => {
    if (selectedPlanId) {
      onSelect(selectedPlanId);
    }
  };

  // Compute savings for each cycle button — use first plan as representative
  // (all plans share the same discount structure)
  const representativePlan = plans[0];
  const quarterlySavingsPct = representativePlan ? getQuarterlySavings(representativePlan) : 0;
  const annualSavingsPct    = representativePlan ? getAnnualSavings(representativePlan) : 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal panel */}
      <div className="relative bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-300 dark:border-white/[0.08] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/[0.05] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Choose a Plan</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Select a plan and billing cycle to proceed to checkout.
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} ariaLabel="Close plan selection modal" size={20} />
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* Billing cycle toggle */}
          <div className="px-6 pt-6">
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl gap-1">
              {(['MONTHLY', 'QUARTERLY', 'ANNUAL'] as BillingCycle[]).map((cycle) => {
                const savings =
                  cycle === 'QUARTERLY' ? quarterlySavingsPct :
                  cycle === 'ANNUAL'    ? annualSavingsPct    : 0;
                const isActive = selectedCycle === cycle;

                return (
                  <button
                    key={cycle}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onCycleChange(cycle)}
                    className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {cycle === 'MONTHLY' ? 'Monthly' : cycle === 'QUARTERLY' ? 'Quarterly' : 'Annual'}
                    {savings > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                        Save {savings}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Plan cards */}
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const price      = getPriceForCycle(plan, selectedCycle);
              const isCurrent  = plan.id === currentPlanId;
              const isSelected = plan.id === selectedPlanId;
              const isPopular  = plan.planType === 'PRO';

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-xl p-5 border transition-all ${
                    isCurrent
                      ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20 cursor-default'
                      : isSelected
                        ? 'border-blue-500 dark:border-blue-400 bg-white dark:bg-slate-900/80 shadow-md cursor-pointer'
                        : 'border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] hover:border-blue-300 dark:hover:border-blue-500/50 cursor-pointer'
                  }`}
                  onClick={() => !isCurrent && handleSelect(plan.id)}
                  role={isCurrent ? undefined : 'button'}
                  tabIndex={isCurrent ? undefined : 0}
                  onKeyDown={(e) => {
                    if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleSelect(plan.id);
                    }
                  }}
                  aria-label={isCurrent ? `${plan.name} — current plan` : `Select ${plan.name}`}
                >
                  {/* Animated selection ring */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        key="ring"
                        layoutId="plan-selection-ring"
                        className="absolute inset-0 rounded-xl border-2 border-blue-500 dark:border-blue-400 pointer-events-none"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      />
                    )}
                  </AnimatePresence>

                  {/* Badges */}
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                    <div className="flex items-center gap-1.5">
                      {isPopular && !isCurrent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300">
                          <Star size={9} className="fill-current" />
                          Popular
                        </span>
                      )}
                      {isCurrent && (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                          Current
                        </span>
                      )}
                      {isSelected && !isCurrent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">
                          <Check size={9} />
                          Selected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Price */}
                  <div className="flex items-end gap-1 mb-4">
                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                      {formatCurrency(price)}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-sm mb-0.5">
                      {CYCLE_CTA_LABELS[selectedCycle]}
                    </span>
                  </div>

                  {/* Features */}
                  <div className="space-y-2 mb-5">
                    {plan.maxUsers != null && (
                      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        {plan.maxUsers === 0 ? 'Unlimited users' : `Up to ${plan.maxUsers} users`}
                      </div>
                    )}
                    {plan.storageLimit != null && (
                      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        {plan.storageLimit >= 1024
                          ? `${(plan.storageLimit / 1024).toFixed(0)} GB storage`
                          : `${plan.storageLimit} MB storage`}
                      </div>
                    )}
                    {plan.features
                      .filter((f) => f.isEnabled)
                      .slice(0, 4)
                      .map((feature) => (
                        <div key={feature.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                          {feature.name}
                        </div>
                      ))}
                  </div>

                  {/* Per-card action */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isCurrent) handleSelect(plan.id);
                    }}
                    disabled={isCurrent}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm transition-colors cursor-pointer disabled:cursor-default ${
                      isCurrent
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                        : isSelected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400'
                    }`}
                    aria-label={isCurrent ? 'Current plan' : isSelected ? `${plan.name} selected` : `Select ${plan.name}`}
                  >
                    {isCurrent ? 'Current Plan' : isSelected ? 'Selected ✓' : 'Select'}
                  </button>
                </div>
              );
            })}
          </div>

          {plans.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No plans available. Contact support for assistance.
            </div>
          )}
        </div>

        {/* Footer CTA — always shows the correct per-cycle price and interval */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-200 dark:border-white/[0.05] bg-white dark:bg-slate-900/50">
          {activePlan ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-white">{activePlan.name}</span>
                {' — '}
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {formatCurrency(getPriceForCycle(activePlan, selectedCycle))}
                </span>
                <span className="text-slate-400 dark:text-slate-500">
                  {CYCLE_CTA_LABELS[selectedCycle]}
                </span>
              </p>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    Continue with {activePlan.name}
                    <TrendingUp size={15} />
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              Select a plan above to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Cancel Confirmation Dialog ───────────────────────────────────────────────

interface CancelConfirmationDialogProps {
  endsAt: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function CancelConfirmationDialog({ endsAt, onConfirm, onCancel, loading }: CancelConfirmationDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/40 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Cancel Subscription?</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            Your subscription will remain active until <strong>{formatDate(endsAt)}</strong>.
            After that, you'll be downgraded to the Free plan.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            Keep Subscription
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Cancelling...
              </>
            ) : (
              'Yes, Cancel'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
