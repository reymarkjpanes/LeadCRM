'use client';

import React, { useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import Link from 'next/link';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SandboxBillingBannerProps {
  /** tenantStatus from /auth/me — SANDBOX shows the banner */
  tenantStatus: string | null | undefined;
  /** subscriptionStatus from /auth/me — NONE (or null) shows the banner */
  subscriptionStatus: string | null | undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SandboxBillingBanner
 *
 * Shown when the user is in the sandbox/pre-subscription state:
 *   tenantStatus = SANDBOX  AND  subscriptionStatus = NONE (or null)
 *
 * Purpose: guides the user to /billing to choose a plan and unlock
 * full production CRM access. Non-blocking — the user can dismiss it
 * per session, but it reappears on the next login until they subscribe.
 *
 * The backend subscriptionGate is the actual enforcement layer.
 * This banner is a UX prompt only — never an authorization boundary.
 */
export function SandboxBillingBanner({
  tenantStatus,
  subscriptionStatus,
}: SandboxBillingBannerProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('leadcrm_sandbox_banner_dismissed') === 'true';
  });

  const isSandbox =
    tenantStatus === 'SANDBOX' &&
    (!subscriptionStatus || subscriptionStatus === 'NONE');

  if (!isSandbox || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem('leadcrm_sandbox_banner_dismissed', 'true');
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20"
    >
      {/* Left — icon + message */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles
          className="h-4 w-4 text-amber-500 dark:text-amber-400 shrink-0"
          aria-hidden="true"
        />
        <p className="text-[12.5px] text-amber-800 dark:text-amber-300 font-medium leading-snug truncate">
          You&apos;re exploring{' '}
          <span className="font-semibold">LeadCRM Sandbox</span>.{' '}
          Choose a plan to unlock full production CRM access.
        </p>
      </div>

      {/* Right — CTA + dismiss */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/billing/client"
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400 text-white text-[12px] font-semibold transition-colors whitespace-nowrap"
        >
          View Plans
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss sandbox banner"
          className="h-6 w-6 flex items-center justify-center rounded text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
