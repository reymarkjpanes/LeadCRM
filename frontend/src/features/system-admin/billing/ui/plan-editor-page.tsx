'use client';
import React, { useState, useCallback } from 'react';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  CreditCard,
  Smartphone,
  Landmark,
  Wallet,
  Apple,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { pricingApiService } from '../services/pricing.service';
import { adminStripeService } from '../services/admin-stripe.service';
import type { PlanPaymentMethod, BillingCycle } from '@leadcrm/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditorFeature {
  id:      string;
  text:    string;
  enabled: boolean;
}

export interface EditorPlan {
  id:             string;
  name:           string;
  price:          number;
  features:       EditorFeature[];
  paymentMethods: PlanPaymentMethod[];
  /** Index in the plans array — used to re-apply isPopular after save */
  planIndex:      number;
  // -- Stripe linkage (null until an existing product/price is attached) --------
  stripeProductId:        string | null;
  stripeMonthlyPriceId:   string | null;
  stripeQuarterlyPriceId: string | null;
  stripeAnnualPriceId:    string | null;
}

interface PlanEditorPageProps {
  plan:     EditorPlan;
  onCancel: () => void;
  /** Called with the saved plan data so the pricing page can update its card */
  onSaved:  (updatedPlan: EditorPlan) => void;
}

// ── Billing period helpers ────────────────────────────────────────────────────

type BillingView = 'Monthly' | 'Quarterly' | 'Annual';

function getPreviewPrice(base: number, view: BillingView): number {
  if (view === 'Quarterly') return Math.round(base * 3 * 0.9);
  if (view === 'Annual')    return Math.round(base * 12 * 0.8);
  return base;
}

function getPreviewLabel(view: BillingView): string {
  if (view === 'Quarterly') return 'quarterly (10% off)';
  if (view === 'Annual')    return 'annual (20% off)';
  return 'monthly';
}

// ── Payment method icon map ───────────────────────────────────────────────────

function PaymentIcon({ methodId }: { methodId: string }): React.ReactElement {
  const cls = 'text-blue-500 dark:text-blue-400 shrink-0';
  switch (methodId) {
    case 'card':          return <CreditCard  size={20} className={cls} />;
    case 'gcash':         return <Wallet      size={20} className={cls} />;
    case 'apple_pay':     return <Apple       size={20} className={cls} />;
    case 'google_pay':    return <Smartphone  size={20} className={cls} />;
    case 'bank_transfer': return <Landmark    size={20} className={cls} />;
    default:              return <CreditCard  size={20} className={cls} />;
  }
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

interface ToggleProps {
  checked:  boolean;
  onChange: (next: boolean) => void;
  label:    string;
}

function Toggle({ checked, onChange, label }: ToggleProps): React.ReactElement {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        checked ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────────

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h2 className="text-[15px] font-bold text-slate-900 dark:text-white mb-1">
      {children}
    </h2>
  );
}

function SectionDescription({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
      {children}
    </p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Full-page Plan Editor.
 * Rendered inside the pricing tab area — the global sidebar and topbar remain
 * visible. Navigation back to the Pricing list is handled via onCancel/onSaved.
 */
export default function PlanEditorPage({
  plan: initialPlan,
  onCancel,
  onSaved,
}: PlanEditorPageProps): React.ReactElement {
  const [draft, setDraft]                   = useState<EditorPlan>(() => ({
    ...initialPlan,
    features:       initialPlan.features.map((f) => ({ ...f })),
    paymentMethods: initialPlan.paymentMethods.map((m) => ({ ...m })),
  }));
  const [billingView, setBillingView]       = useState<BillingView>('Monthly');
  const [isSaving, setIsSaving]             = useState(false);
  const [priceIdInput, setPriceIdInput]     = useState('');
  const [attachCycle, setAttachCycle]       = useState<BillingCycle>('MONTHLY');
  const [isAttaching, setIsAttaching]       = useState(false);

  // ── Feature helpers ─────────────────────────────────────────────────────────

  const updateFeature = useCallback(
    (idx: number, patch: Partial<EditorFeature>) => {
      setDraft((prev) => {
        const next = [...prev.features];
        next[idx]  = { ...next[idx], ...patch };
        return { ...prev, features: next };
      });
    },
    [],
  );

  const removeFeature = useCallback((idx: number) => {
    setDraft((prev) => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== idx),
    }));
  }, []);

  const addFeature = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      features: [
        ...prev.features,
        { id: `new-${Date.now()}`, text: '', enabled: true },
      ],
    }));
  }, []);

  // ── Payment method helpers ──────────────────────────────────────────────────

  const togglePaymentMethod = useCallback((methodId: string, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      paymentMethods: prev.paymentMethods.map((m) =>
        m.id === methodId ? { ...m, enabled } : m,
      ),
    }));
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async (): Promise<void> => {
    if (isSaving) return;

    if (!draft.name.trim()) {
      toast.error('Plan name cannot be empty.');
      return;
    }
    if (draft.price < 0) {
      toast.error('Price cannot be negative.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await pricingApiService.updatePlan(draft.id, {
        name:           draft.name.trim(),
        monthlyPrice:   draft.price,
        features:       draft.features
          .filter((f) => f.text.trim() !== '')
          .map((f) => ({ name: f.text.trim(), enabled: f.enabled })),
        paymentMethods: draft.paymentMethods.map((m) => ({
          id:          m.id,
          name:        m.name,
          description: m.description,
          enabled:     m.enabled,
        })),
      });

      if (!response.success) {
        throw new Error('Save returned a failure response.');
      }

      // Non-fatal Stripe sync
      adminStripeService.syncPlan(draft.id).catch(() => {
        // Plan saved in DB; Stripe sync can be retried separately
      });

      // Build the updated editor plan from the server-authoritative response
      const saved = response.data;
      const updatedEditorPlan: EditorPlan = {
        id:        saved.id,
        name:      saved.name,
        price:     saved.monthlyPrice,
        planIndex: draft.planIndex,
        features:  saved.features.map((f) => ({
          id:      f.id,
          text:    f.name,
          enabled: f.enabled,
        })),
        paymentMethods: saved.paymentMethods,
        stripeProductId:        saved.stripeProductId,
        stripeMonthlyPriceId:   saved.stripeMonthlyPriceId,
        stripeQuarterlyPriceId: saved.stripeQuarterlyPriceId,
        stripeAnnualPriceId:    saved.stripeAnnualPriceId,
      };

      onSaved(updatedEditorPlan);
      toast.success(`${saved.name} plan saved.`);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to save plan. Please try again.';
      toast.error(message);
      // Stay on the editor — preserve the admin's entered values
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, onSaved]);

  // ── Attach existing Stripe price ──────────────────────────────────────────

  const handleAttachStripePrice = useCallback(async (): Promise<void> => {
    if (isAttaching) return;

    const priceId = priceIdInput.trim();
    if (!priceId.startsWith('price_')) {
      toast.error('Enter a valid Stripe Price ID (starts with "price_").');
      return;
    }

    setIsAttaching(true);
    try {
      const response = await pricingApiService.attachStripePrice(draft.id, {
        billingCycle: attachCycle,
        priceId,
      });

      if (!response.success) {
        throw new Error('Attach returned a failure response.');
      }

      const result = response.data;

      // Server is authoritative — update the draft with the returned Stripe IDs.
      setDraft((prev) => ({
        ...prev,
        stripeProductId:        result.plan.stripeProductId,
        stripeMonthlyPriceId:   result.plan.stripeMonthlyPriceId,
        stripeQuarterlyPriceId: result.plan.stripeQuarterlyPriceId,
        stripeAnnualPriceId:    result.plan.stripeAnnualPriceId,
      }));
      setPriceIdInput('');

      toast.success(`Stripe price attached for ${attachCycle.toLowerCase()} billing.`);
      // Surface non-blocking reconciliation warnings (e.g. currency/amount mismatch)
      result.warnings.forEach((warning) => toast.warning(warning));
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to attach Stripe price. Please try again.';
      toast.error(message);
    } finally {
      setIsAttaching(false);
    }
  }, [attachCycle, draft.id, isAttaching, priceIdInput]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const previewPrice = getPreviewPrice(draft.price, billingView);
  const previewLabel = getPreviewLabel(billingView);

  const stripeCycleRows: Array<{ cycle: BillingCycle; label: string; priceId: string | null }> = [
    { cycle: 'MONTHLY',   label: 'Monthly',   priceId: draft.stripeMonthlyPriceId   },
    { cycle: 'QUARTERLY', label: 'Quarterly', priceId: draft.stripeQuarterlyPriceId },
    { cycle: 'ANNUAL',    label: 'Annual',    priceId: draft.stripeAnnualPriceId    },
  ];

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Scrollable content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-10 py-8 space-y-8">

          {/* Back link */}
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
          >
            <ArrowLeft
              size={15}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            Back to Pricing
          </button>

          {/* Page header */}
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Edit {draft.name} Plan
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Manage plan pricing, features, and available payment methods.
            </p>
          </div>

          {/* ── Plan Information ─────────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>Plan Information</SectionTitle>

            {/* Name + Price row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label
                  htmlFor="plan-name"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Plan Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-white/[0.10] rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                  placeholder="e.g. Professional"
                />
              </div>
              <div>
                <label
                  htmlFor="plan-price"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Monthly Price (₱)
                </label>
                <input
                  id="plan-price"
                  type="number"
                  min={0}
                  value={draft.price}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, price: Math.max(0, Number(e.target.value)) }))
                  }
                  className="w-full border border-slate-200 dark:border-white/[0.10] rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                />
              </div>
            </div>

            {/* Billing period preview */}
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                Billing Period Preview
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Period selector */}
                <div
                  role="group"
                  aria-label="Billing period"
                  className="inline-flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02]"
                >
                  {(['Monthly', 'Quarterly', 'Annual'] as BillingView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setBillingView(v)}
                      aria-pressed={billingView === v}
                      className={cn(
                        'px-3 h-7 rounded-lg text-xs font-semibold transition-colors active:scale-95',
                        billingView === v
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {/* Price preview */}
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  ₱{previewPrice.toLocaleString()}
                  <span className="text-xs font-normal text-slate-400 ml-1">/ {previewLabel}</span>
                </span>
              </div>
            </div>
          </SectionCard>

          {/* ── Features + Payment Methods (side by side on large screens) ────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* ── Features ─────────────────────────────────────────────────────── */}
          <SectionCard className="h-full">
            <SectionTitle>Features</SectionTitle>
            <SectionDescription>
              Enable, rename, add, or remove the features included in this plan.
            </SectionDescription>

            {draft.features.length === 0 && (
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-4 italic">
                No features yet. Add one below.
              </p>
            )}

            <div className="space-y-2 mb-4">
              {draft.features.map((feature, idx) => (
                <div
                  key={feature.id}
                  className="flex items-center gap-3 group rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-white/[0.07] hover:bg-slate-50 dark:hover:bg-white/[0.02] px-2 py-1.5 transition-colors"
                >
                  {/* Enabled checkbox */}
                  <button
                    type="button"
                    aria-label={feature.enabled ? 'Disable feature' : 'Enable feature'}
                    onClick={() => updateFeature(idx, { enabled: !feature.enabled })}
                    className="shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    <CheckCircle2
                      size={18}
                      className={cn(
                        'transition-colors',
                        feature.enabled
                          ? 'text-blue-500'
                          : 'text-slate-300 dark:text-slate-600',
                      )}
                    />
                  </button>

                  {/* Name input */}
                  <input
                    type="text"
                    value={feature.text}
                    onChange={(e) => updateFeature(idx, { text: e.target.value })}
                    placeholder="Feature name"
                    className={cn(
                      'flex-1 bg-transparent text-sm focus:outline-none focus:ring-0 border-0',
                      feature.enabled
                        ? 'text-slate-800 dark:text-slate-200'
                        : 'text-slate-400 dark:text-slate-600 line-through',
                    )}
                  />

                  {/* Delete */}
                  <button
                    type="button"
                    aria-label="Remove feature"
                    onClick={() => removeFeature(idx)}
                    className="shrink-0 p-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add feature */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addFeature}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <Plus size={15} />
                Add Feature
              </button>
            </div>
          </SectionCard>

          {/* ── Available Payment Methods ─────────────────────────────────────── */}
          <SectionCard className="h-full">
            <SectionTitle>Available Payment Methods</SectionTitle>
            <SectionDescription>
              Choose the payment methods customers can use when subscribing to this plan.
            </SectionDescription>

            <div className="space-y-3">
              {draft.paymentMethods.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center gap-4 rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] px-4 py-3"
                >
                  {/* Icon */}
                  <div className="w-9 h-9 rounded-lg bg-white dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center shrink-0">
                    <PaymentIcon methodId={method.id} />
                  </div>

                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {method.name}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                      {method.description}
                    </p>
                  </div>

                  {/* ON/OFF label + toggle */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        method.enabled
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-400 dark:text-slate-500',
                      )}
                    >
                      {method.enabled ? 'ON' : 'OFF'}
                    </span>
                    <Toggle
                      checked={method.enabled}
                      onChange={(next) => togglePaymentMethod(method.id, next)}
                      label={`Toggle ${method.name}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Stripe note */}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 leading-relaxed">
              Payment method availability may depend on Stripe configuration, customer location,
              currency, and payment eligibility.
            </p>
          </SectionCard>
          </div>
          {/* end Features + Payment Methods grid */}

          {/* ── Stripe Integration ───────────────────────────────────────────── */}
          <SectionCard>
            <SectionTitle>Stripe Integration</SectionTitle>
            <SectionDescription>
              Attach an existing Stripe price (created in the Stripe Dashboard) to enable
              checkout for this plan. The product is derived and verified from the price.
            </SectionDescription>

            {/* Product id */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Stripe Product
              </p>
              <p className="text-sm font-mono text-slate-700 dark:text-slate-200 break-all">
                {draft.stripeProductId ?? (
                  <span className="font-sans italic text-slate-400 dark:text-slate-500">
                    Not linked yet
                  </span>
                )}
              </p>
            </div>

            {/* Per-cycle attached price ids */}
            <div className="space-y-2 mb-6">
              {stripeCycleRows.map((row) => (
                <div
                  key={row.cycle}
                  className="flex items-center gap-4 rounded-lg border border-slate-100 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] px-4 py-3"
                >
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 w-24 shrink-0">
                    {row.label}
                  </span>
                  {row.priceId ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-mono text-slate-600 dark:text-slate-300 break-all">
                      <CheckCircle2 size={15} className="text-blue-500 shrink-0" />
                      {row.priceId}
                    </span>
                  ) : (
                    <span className="text-sm italic text-slate-400 dark:text-slate-500">
                      No price attached
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Attach control */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="sm:w-40 shrink-0">
                <label
                  htmlFor="stripe-attach-cycle"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Billing Cycle
                </label>
                <div
                  role="group"
                  aria-label="Billing cycle to attach"
                  id="stripe-attach-cycle"
                  className="inline-flex items-center gap-1 p-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] w-full"
                >
                  {(['MONTHLY', 'QUARTERLY', 'ANNUAL'] as BillingCycle[]).map((cycle) => (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setAttachCycle(cycle)}
                      aria-pressed={attachCycle === cycle}
                      className={cn(
                        'flex-1 px-2 h-7 rounded-lg text-[11px] font-semibold transition-colors active:scale-95',
                        attachCycle === cycle
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white',
                      )}
                    >
                      {cycle.charAt(0) + cycle.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1">
                <label
                  htmlFor="stripe-price-id"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Stripe Price ID
                </label>
                <input
                  id="stripe-price-id"
                  type="text"
                  value={priceIdInput}
                  onChange={(e) => setPriceIdInput(e.target.value)}
                  placeholder="price_..."
                  className="w-full border border-slate-200 dark:border-white/[0.10] rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                />
              </div>

              <button
                type="button"
                onClick={handleAttachStripePrice}
                disabled={isAttaching || priceIdInput.trim() === ''}
                className="px-5 h-[38px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-70 active:scale-95 shrink-0"
              >
                {isAttaching && <Loader2 size={15} className="animate-spin" />}
                Attach
              </button>
            </div>
          </SectionCard>

          {/* Bottom spacer so content isn't hidden behind sticky bar */}
          <div className="h-4" />
        </div>
      </div>

      {/* ── Sticky action bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 sticky bottom-0 z-10 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-white/[0.07] px-4 sm:px-8 lg:px-10 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block">
            All changes saved when you click Save Changes.
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-70 active:scale-95"
            >
              {isSaving && <Loader2 size={15} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
