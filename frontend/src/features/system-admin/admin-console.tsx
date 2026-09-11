'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AdminDashboard from './dashboard/ui/admin-dashboard';
import ClientManagement from './tenants/ui/client-management';
import PricingPage, { type UiPlan } from './billing/ui/pricing-page';
import PlanEditorPage, { type EditorPlan } from './billing/ui/plan-editor-page';
import AdminBillingPage from './billing/ui/admin-billing-page';
import WebhookEventsPage from './billing/ui/webhook-events-page';
import AuditLogsPage from '../tenant/administration/audit/ui/audit-logs-page';
import { useAdminSubLabel } from './layout/admin-sub-label-context';
import type { PlanPaymentMethod } from '@leadcrm/shared';

// ── Default payment methods (inlined to avoid shared-package const resolution issues) ──
const DEFAULT_PM: Omit<PlanPaymentMethod, 'enabled'>[] = [
  { id: 'card',          name: 'Credit / Debit Cards', description: 'Accept major credit and debit cards.' },
  { id: 'gcash',         name: 'GCash',                description: 'Allow customers to pay using GCash.' },
  { id: 'apple_pay',     name: 'Apple Pay',            description: 'Offer a seamless Apple Pay experience.' },
  { id: 'google_pay',    name: 'Google Pay',           description: 'Let customers pay with Google Pay.' },
  { id: 'bank_transfer', name: 'Bank Transfer',        description: 'Accept direct bank transfers.' },
];

type TabId = 'dashboard' | 'clients' | 'pricing' | 'billing' | 'webhooks' | 'audit';

interface AdminConsoleProps {
  activeTabProp?: TabId;
}

// ── Sub-view state for pricing ────────────────────────────────────────────────

interface PricingSubView {
  kind: 'editor';
  plan: EditorPlan;
}

// ── Tab components (non-pricing tabs rendered directly) ───────────────────────

const NON_PRICING_TAB_MAP: Partial<Record<TabId, React.ComponentType>> = {
  dashboard: AdminDashboard,
  clients:   ClientManagement,
  billing:   AdminBillingPage,
  webhooks:  WebhookEventsPage,
  audit:     AuditLogsPage,
};

// ── Payment method hydration ──────────────────────────────────────────────────
// Ensure the editor always has the full set of payment methods, even when the
// plan was loaded from fallback data or the DB column is empty.

function hydratePaymentMethods(stored: PlanPaymentMethod[]): PlanPaymentMethod[] {
  const storedMap = new Map((stored ?? []).map((m) => [m.id, m]));
  return DEFAULT_PM.map((def) => {
    const saved = storedMap.get(def.id);
    return {
      id:          def.id,
      name:        saved?.name        ?? def.name,
      description: saved?.description ?? def.description,
      enabled:     saved?.enabled     ?? false,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminConsole({ activeTabProp = 'dashboard' }: AdminConsoleProps) {
  const [activeTab, setActiveTab]           = useState<TabId>(activeTabProp);
  const [pricingSubView, setPricingSubView] = useState<PricingSubView | null>(null);
  const [pricingRefreshKey, setPricingRefreshKey] = useState(0);

  const { setSubLabel } = useAdminSubLabel();

  useEffect(() => {
    setActiveTab(activeTabProp);
    if (activeTabProp !== 'pricing') {
      setPricingSubView(null);
      setSubLabel(null);
    }
  }, [activeTabProp, setSubLabel]);

  // ── Pricing sub-view handlers ─────────────────────────────────────────────

  const handleEditPlan = useCallback(
    (plan: UiPlan, planIndex: number) => {
      const editorPlan: EditorPlan = {
        id:             plan.id,
        name:           plan.name,
        price:          plan.price,
        planIndex,
        features:       plan.features.map((f) => ({ ...f })),
        paymentMethods: hydratePaymentMethods(plan.paymentMethods),
        stripeProductId:        plan.stripeProductId,
        stripeMonthlyPriceId:   plan.stripeMonthlyPriceId,
        stripeQuarterlyPriceId: plan.stripeQuarterlyPriceId,
        stripeAnnualPriceId:    plan.stripeAnnualPriceId,
      };
      setPricingSubView({ kind: 'editor', plan: editorPlan });
      setSubLabel(`Edit ${plan.name}`);
    },
    [setSubLabel],
  );

  const handleEditorCancel = useCallback(() => {
    setPricingSubView(null);
    setSubLabel(null);
  }, [setSubLabel]);

  const handleEditorSaved = useCallback(
    (_savedPlan: EditorPlan) => {
      setPricingSubView(null);
      setSubLabel(null);
      // Remount PricingPage so it re-fetches plan cards from the API
      setPricingRefreshKey((k) => k + 1);
    },
    [setSubLabel],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (activeTab === 'pricing') {
    if (pricingSubView?.kind === 'editor') {
      return (
        <PlanEditorPage
          plan={pricingSubView.plan}
          onCancel={handleEditorCancel}
          onSaved={handleEditorSaved}
        />
      );
    }

    return (
      <PricingPage
        key={pricingRefreshKey}
        onEditPlan={handleEditPlan}
      />
    );
  }

  const ActivePage = NON_PRICING_TAB_MAP[activeTab] ?? AdminDashboard;
  return <ActivePage />;
}
