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
  /** True when a Guest/sandbox user attempts a blocked mutation — prompts them to subscribe */
  showSubscriptionModal: boolean;
  /** Why the subscription modal is showing — drives the modal's copy */
  subscriptionInfo: SubscriptionRequiredInfo | null;
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

/** Why the sandbox upgrade modal was triggered. */
export type SubscriptionRequiredReason = 'subscription' | 'record_limit';

export interface SubscriptionRequiredInfo {
  reason: SubscriptionRequiredReason;
  /** For record_limit: which entity hit the cap (contacts | users | deals). */
  entityType?: string;
  /** For record_limit: the plan's max for that entity. */
  max?: number;
}

/**
 * Dispatch this event when the API returns 403 with code SUBSCRIPTION_REQUIRED
 * or RECORD_LIMIT_REACHED. Fired when a Guest/sandbox user either has no
 * subscription at all, or has hit a Free-plan record limit (100 contacts, 3 users).
 * The CRM layout shell listens for this and shows the sandbox upgrade modal.
 */
export function dispatchSubscriptionRequired(info?: SubscriptionRequiredInfo): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('subscription-required', {
      detail: info ?? { reason: 'subscription' },
    }),
  );
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
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionRequiredInfo | null>(null);

  useEffect(() => {
    function handleUpgradeRequired(e: Event): void {
      const detail = (e as CustomEvent<PlanUpgradeInfo>).detail;
      setUpgradeInfo(detail);
      setShowUpgradeModal(true);
    }

    function handleSubscriptionRequired(e: Event): void {
      const detail = (e as CustomEvent<SubscriptionRequiredInfo>).detail;
      setSubscriptionInfo(detail ?? { reason: 'subscription' });
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
    setSubscriptionInfo(null);
  }, []);

  return {
    upgradeInfo,
    showUpgradeModal,
    closeUpgradeModal,
    showSubscriptionModal,
    subscriptionInfo,
    closeSubscriptionModal,
  };
}
