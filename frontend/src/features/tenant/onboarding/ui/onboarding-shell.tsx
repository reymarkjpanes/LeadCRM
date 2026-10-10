'use client';

import { useState, type ReactNode } from 'react';
import { Compass, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';

export function OnboardingShell({
  step, totalSteps, title = 'Welcome to LeadCRM', description = 'Your customer relationships and daily work, together.',
  icon: Icon = Compass, children,
}: { step: number; totalSteps?: number; title?: string; description?: string; icon?: LucideIcon; children: ReactNode }) {
  const { logout } = useAuth();
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try { await logout(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out. Try again.');
      setSigningOut(false);
    }
  }
  return (
    <main className="grid min-h-[var(--app-viewport-height)] bg-white text-slate-900 lg:grid-cols-2 dark:bg-slate-950 dark:text-white">
      <aside className="flex min-w-0 flex-col bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 p-5 text-white sm:p-10 lg:min-h-[var(--app-viewport-height)] lg:p-12 xl:p-16">
        <div className="flex items-center gap-3 text-2xl font-bold">
          <span className="rounded-xl bg-white p-2.5"><img src="/leadcrm_logo.png" alt="" className="h-7 w-7 object-contain" /></span>
          LeadCRM
        </div>
        <div className="my-8 max-w-lg lg:my-auto lg:py-16">
          <Icon aria-hidden="true" className="mb-5 h-10 w-10 lg:mb-8 lg:h-14 lg:w-14" strokeWidth={1.5} />
          <h2 className="text-3xl font-bold leading-tight sm:text-4xl xl:text-5xl">{title}</h2>
          <p className="mt-4 text-base leading-relaxed text-blue-50 sm:text-lg lg:mt-6 lg:text-xl">{description}</p>
        </div>
        {totalSteps ? <div className="max-w-lg">
          <p className="mb-3 text-sm text-blue-50">Step {step + 1} of {totalSteps}</p>
          <ol aria-label="Onboarding progress" className="flex gap-2">
            {Array.from({ length: totalSteps }, (_, index) => <li key={index}
              aria-current={index === step ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? 'bg-white' : 'bg-white/30'}`}>
              <span className="sr-only">Step {index + 1}{index < step ? ', visited' : ''}</span>
            </li>)}
          </ol>
        </div> : <p className="text-sm text-blue-50">Camxian Technologies · Secure account setup</p>}
      </aside>
      <section className="flex min-w-0 flex-col px-5 py-5 sm:px-10 lg:px-12 xl:px-16">
        <div className="mb-6 flex justify-end">
          <button type="button" disabled={signingOut} onClick={() => void signOut()}
            className="min-h-11 rounded-lg px-2 text-sm text-slate-500 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center pb-4 lg:py-10">
          {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
          {children}
        </div>
      </section>
    </main>
  );
}

export const primaryButton =
  'min-h-11 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
export const secondaryButton =
  'min-h-11 rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:hover:bg-slate-800 disabled:opacity-50';
