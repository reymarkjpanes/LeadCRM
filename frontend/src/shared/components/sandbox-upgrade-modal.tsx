'use client';

import React from 'react';
import { Sparkles, X, ArrowRight, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import type { SubscriptionRequiredInfo } from '@/shared/hooks/use-billing-interceptor';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SandboxUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Why the modal is showing — drives the copy. Defaults to generic subscription prompt. */
  info?: SubscriptionRequiredInfo | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SandboxUpgradeModal
 *
 * Shown to Free/sandbox (Guest) users in two situations:
 *   1. reason='record_limit'  → they hit a Free-plan cap (100 contacts / 3 users)
 *   2. reason='subscription'  → a fully unsubscribed tenant attempted a mutation
 *
 * Guides the user to /billing/client to choose a paid plan and lift the limits.
 */
export function SandboxUpgradeModal({
  isOpen,
  onClose,
  info,
}: SandboxUpgradeModalProps): React.ReactElement | null {
  const router = useRouter();

  const handleViewPlans = (): void => {
    onClose();
    router.push('/billing/client');
  };

  const isRecordLimit = info?.reason === 'record_limit';

  // Friendly label for the entity that hit the cap.
  const entityLabel = ((): string => {
    switch (info?.entityType) {
      case 'contacts': return 'contacts';
      case 'users':    return 'team members';
      case 'deals':    return 'deals';
      default:         return 'records';
    }
  })();

  const title = isRecordLimit ? 'Free Plan Limit Reached' : 'Upgrade Your Plan';

  const description = isRecordLimit
    ? info?.max
      ? `You've reached the Free plan limit of ${info.max} ${entityLabel}. Upgrade to add more and unlock premium features.`
      : `You've reached your Free plan limit for ${entityLabel}. Upgrade to add more.`
    : "You're on the Free plan. Upgrade to unlock automation, advanced reporting, more team members, and higher limits.";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sandbox-upgrade-title"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Icon */}
            <div className="flex justify-center mb-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/25">
                <Lock className="h-7 w-7 text-white" />
              </div>
            </div>

            {/* Content */}
            <div className="text-center mb-6">
              <h3
                id="sandbox-upgrade-title"
                className="text-xl font-bold text-slate-900 dark:text-white mb-2"
              >
                {title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {description}
              </p>
            </div>

            {/* Current Free plan summary */}
            <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                Your Free Plan
              </p>
              <ul className="space-y-1.5">
                {[
                  'Basic CRM (Leads, Contacts, Deals & more)',
                  'Up to 3 team members',
                  '100 contacts limit',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* What unlocks with a paid plan */}
            <ul className="mb-6 space-y-2 p-4 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-100 dark:border-amber-500/20">
              <li className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">
                Unlock with a paid plan
              </li>
              {[
                'Workflow automation',
                'Marketing campaigns',
                'Advanced reporting',
                'More team members & higher limits',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-[13px] text-amber-800 dark:text-amber-300">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Maybe Later
              </button>
              <button
                type="button"
                onClick={handleViewPlans}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-sm transition-colors"
              >
                View Plans
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
