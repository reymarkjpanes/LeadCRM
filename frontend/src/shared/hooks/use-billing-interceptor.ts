'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanUpgradeInfo {
  feature: string;
  currentPlan: string;
  requiredPlan: string;
}

interface UseBillingInterceptorReturn {
  upgradeInfo: PlanUpgradeInfo | null;
  showUpgradeModal: boolean;
  closeUpgradeModal: () => void;
  /** True when a Guest/sandbox user attempts a mutation — prompts them to subscribe */
  showSubscriptionModal: boolean;
  closeSubscriptionModal: () => void;
}

// ─── Custom Events ────────────────────────────────────────────────────────────

/** Dispatch this event when the API returns 403 with code PLAN_UPGRADE_REQUIRED */
export function dispatchPlanUpgradeRequired(detail: PlanUpgradeInfo): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('plan-upgrade-required', { detail }));
}

/** Dispatch this event when the API returns 402 with code PAYMENT_REQUIRED */
export function dispatchPaymentRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('payment-required'));
}

/**
 * Dispatch this event when the API returns 403 with code SUBSCRIPTION_REQUIRED.
 * Fired when a Guest/sandbox user attempts any mutation (create, update, delete).
 * The CRM layout shell listens for this and shows the sandbox upgrade modal.
 */
export function dispatchSubscriptionRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('subscription-required'));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook that listens for billing-related custom events and manages modal state.
 * Wire this into the tenant layout shell (crm-layout.tsx).
 *
 * Handles three distinct scenarios:
 *   plan-upgrade-required    → user on a paid plan tries a feature above their tier
 *   payment-required         → subscription is past-due / cancelled
 *   subscription-required    → Guest/sandbox user tries to mutate data (no subscription yet)
 */
export function useBillingInterceptor(): UseBillingInterceptorReturn {
  const [upgradeInfo, setUpgradeInfo] = useState<PlanUpgradeInfo | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  useEffect(() => {
    function handleUpgradeRequired(e: Event): void {
      const detail = (e as CustomEvent<PlanUpgradeInfo>).detail;
      setUpgradeInfo(detail);
      setShowUpgradeModal(true);
    }

    function handleSubscriptionRequired(): void {
      setShowSubscriptionModal(true);
    }

    window.addEventListener('plan-upgrade-required', handleUpgradeRequired);
    window.addEventListener('subscription-required', handleSubscriptionRequired);

    return () => {
      window.removeEventListener('plan-upgrade-required', handleUpgradeRequired);
      window.removeEventListener('subscription-required', handleSubscriptionRequired);
    };
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setShowUpgradeModal(false);
    setUpgradeInfo(null);
  }, []);

  const closeSubscriptionModal = useCallback(() => {
    setShowSubscriptionModal(false);
  }, []);

  return {
    upgradeInfo,
    showUpgradeModal,
    closeUpgradeModal,
    showSubscriptionModal,
    closeSubscriptionModal,
  };
}
