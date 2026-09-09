'use client';

import React from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SetupCompleteCardProps {
  /** The company/workspace name shown in the success message. */
  companyName: string;
  /** Called when the user clicks "View Plans". Parent handles navigation. */
  onViewPlans: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SetupCompleteCard
 *
 * Shared success-state card rendered by both the /company-setup and /onboarding
 * flows after workspace setup completes. Shows a clear completion message and
 * a single "View Plans" CTA that guides the user toward /billing/client.
 *
 * No side effects. Navigation is delegated to the parent via onViewPlans.
 * No activation logic lives here — the Stripe webhook is the sole authority.
 */
export function SetupCompleteCard({
  companyName,
  onViewPlans,
}: SetupCompleteCardProps): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/5 shadow-xl p-8 text-center"
    >
      {/* Success icon */}
      <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
        <CheckCircle2
          className="text-emerald-600 dark:text-emerald-400"
          size={32}
          aria-hidden="true"
        />
      </div>

      {/* Heading */}
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
        Company Setup Complete
      </h2>

      {/* Body */}
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed">
        {companyName ? (
          <>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {companyName}
            </span>{' '}
            has been successfully set up.{' '}
          </>
        ) : null}
        Your workspace is ready.
      </p>

      {/* Next-step callout */}
      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 mb-8 text-left">
        <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
          <span className="font-semibold">Next step:</span> Choose a LeadCRM plan to activate
          your workspace and unlock full CRM access.
        </p>
      </div>

      {/* Primary CTA */}
      <button
        type="button"
        onClick={onViewPlans}
        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-sm cursor-pointer"
      >
        View Plans
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      {/* Secondary note */}
      <p className="mt-5 text-xs text-slate-400 dark:text-slate-500">
        You can also access billing anytime from the Settings menu.
      </p>
    </motion.div>
  );
}