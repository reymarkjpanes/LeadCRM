'use client';
import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useOnboarding } from '../hooks/use-onboarding';
import { onboardingTopics } from './onboarding-content';
import { OnboardingShell, primaryButton, secondaryButton } from './onboarding-shell';

export default function OnboardingPage() {
  const { complete, isSaving, error } = useOnboarding();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const topic = onboardingTopics[step];
  const Icon = topic.icon;
  const isLast = step === onboardingTopics.length - 1;
  function next() {
    setStep(current => Math.min(current + 1, onboardingTopics.length - 1));
    heading.current?.focus();
  }
  return <OnboardingShell step={step} totalSteps={onboardingTopics.length} title={topic.theme}
    description={topic.description} icon={Icon}>
    <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950"><Icon aria-hidden="true" className="h-6 w-6" /></div>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold leading-tight outline-none sm:text-3xl">{topic.title}</h1>
    <p className="mt-3 leading-relaxed text-slate-500 dark:text-slate-400">{topic.intro}</p>
    <div className="my-8 space-y-6">{topic.features.map(([title, description]) => <div key={title}>
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
    </div>)}</div>
    <p className="border-l-2 border-blue-500 pl-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{topic.note}</p>
    {error && <p role="alert" className="mt-5 text-sm text-red-600">{error}</p>}
    <nav aria-label="Tour navigation" className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t border-slate-100 bg-white py-4 dark:border-slate-800 dark:bg-slate-950">
      <button className={secondaryButton} disabled={isSaving} onClick={() => void complete()}>Skip</button>
      <button className={primaryButton + ' inline-flex items-center gap-2'} disabled={isSaving}
        onClick={() => isLast ? void complete() : next()}>
        {isSaving ? 'Saving…' : isLast ? 'Finish' : 'Next'}<ArrowRight aria-hidden="true" className="h-4 w-4" />
      </button>
    </nav>
  </OnboardingShell>;
}
