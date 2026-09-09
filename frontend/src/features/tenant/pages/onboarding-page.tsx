'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Users, Rocket, ChevronRight, ArrowLeft,
  Plus, X, Check, SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/shared/services/auth.api';
import { useAuth } from '@/store/AuthContext';
import { SetupCompleteCard } from '@/shared/components/setup-complete-card';

interface OnboardingPageProps {
  onNavigate: (path: string) => void;
  needsCompanySetup?: boolean;
}

const INDUSTRIES = [
  'IT Solutions', 'Security Services', 'Telecom', 'Healthcare', 'Finance',
  'Education', 'Manufacturing', 'Retail', 'Real Estate', 'Consulting',
  'Marketing/Advertising', 'Legal', 'Energy', 'Transportation', 'Other',
];

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'];

export default function OnboardingPage({ onNavigate }: OnboardingPageProps): React.ReactElement {
  const { refreshUser } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading]     = useState(true);
  const [isSaving, setIsSaving]       = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  // Step 1: Workspace data
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry]       = useState('');
  const [companySize, setCompanySize] = useState('');
  const [timezone, setTimezone]       = useState('');

  // Step 2: Invite data
  const [inviteEmail, setInviteEmail]     = useState('');
  const [inviteEmails, setInviteEmails]   = useState<string[]>([]);
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  const [invitesSent, setInvitesSent]     = useState(false);

  // Load existing onboarding state on mount
  useEffect(() => {
    const loadStatus = async (): Promise<void> => {
      try {
        const response = await authApi.getOnboardingStatus();
        if (response?.data) {
          const { step, completedAt, tenant } = response.data;

          // Already completed — show the success card (handles page refresh after setup).
          // Also populate companyName so the card shows the name after a page refresh.
          if (completedAt) {
            if (tenant.name) setCompanyName(tenant.name);
            setSetupComplete(true);
            setIsLoading(false);
            return;
          }

          setCurrentStep(step);
          if (tenant.name)        setCompanyName(tenant.name);
          if (tenant.industry)    setIndustry(tenant.industry);
          if (tenant.companySize) setCompanySize(tenant.companySize);
        }
      } catch {
        // Status fetch failed — start from step 0
      } finally {
        setIsLoading(false);
      }
    };

    void loadStatus();

    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setTimezone('UTC');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 1: Save workspace ────────────────────────────────────────────────

  const handleSaveWorkspace = async (): Promise<void> => {
    if (!companyName.trim() || !industry || !companySize) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setIsSaving(true);
    try {
      await authApi.saveOnboardingWorkspace({ companyName: companyName.trim(), industry, companySize, timezone });
      setCurrentStep(1);
      await authApi.updateOnboardingStep(1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save workspace details.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Step 2: Invite helpers ────────────────────────────────────────────────

  const handleAddEmail = useCallback((): void => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (inviteEmails.includes(email)) {
      toast.error('This email is already in the list.');
      return;
    }
    if (inviteEmails.length >= 10) {
      toast.error('Maximum 10 invitations at a time.');
      return;
    }
    setInviteEmails((prev) => [...prev, email]);
    setInviteEmail('');
  }, [inviteEmail, inviteEmails]);

  const handleRemoveEmail = (email: string): void => {
    setInviteEmails((prev) => prev.filter((e) => e !== email));
  };

  const handleSendInvitations = async (): Promise<void> => {
    if (inviteEmails.length === 0) {
      await handleSkipInvite();
      return;
    }
    setIsSendingInvites(true);
    try {
      const response = await authApi.sendInvitations(inviteEmails, '');
      if (response?.data) {
        const sentCount = response.data.sent.length;
        if (sentCount > 0) toast.success(`${sentCount} invitation${sentCount > 1 ? 's' : ''} sent!`);
        response.data.skipped.forEach((s) => toast.info(`${s.email}: ${s.reason}`));
      }
      setInvitesSent(true);
      setCurrentStep(2);
      await authApi.updateOnboardingStep(2);
    } catch (err: unknown) {
      // Invitations are optional — advance even if sending fails
      toast.error((err instanceof Error ? err.message : 'Failed to send invitations.') + ' You can invite team members later from Settings.');
      setCurrentStep(2);
      await authApi.updateOnboardingStep(2).catch(() => { /* non-critical */ });
    } finally {
      setIsSendingInvites(false);
    }
  };

  const handleSkipInvite = async (): Promise<void> => {
    setCurrentStep(2);
    try { await authApi.updateOnboardingStep(2); } catch { /* non-critical */ }
  };

  // ── Step 3: Complete onboarding ───────────────────────────────────────────

  const handleComplete = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await authApi.completeOnboarding();

      // Belt-and-suspenders: set localStorage flag so AuthGuard's onboarding gate clears
      // even before the next /auth/me response arrives. Server remains source of truth.
      if (typeof window !== 'undefined') {
        localStorage.setItem('leadcrm_onboarding_complete', 'true');
      }

      // Re-hydrate AuthContext so onboardingCompletedAt is current before any navigation.
      // Must complete before showing the success card so AuthGuard has the fresh state.
      await refreshUser();

      toast.success('Your workspace is ready!');
      // Show the success card — user explicitly clicks 'View Plans' to continue to billing
      setSetupComplete(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete onboarding.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-slate-500 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  // ── Setup complete state ──────────────────────────────────────────────────

  if (setupComplete) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col">
        <header className="px-6 py-4 flex items-center border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <img src="/leadcrm_logo.png" alt="LeadCRM" className="w-5 h-5 object-contain" />
            </div>
            <span className="font-bold text-slate-900 dark:text-white">LeadCRM</span>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg">
            <SetupCompleteCard
              companyName={companyName}
              onViewPlans={() => onNavigate('billing')}
            />
          </div>
        </main>
      </div>
    );
  }

  // ── Step-by-step onboarding ───────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <img src="/leadcrm_logo.png" alt="LeadCRM" className="w-5 h-5 object-contain" />
          </div>
          <span className="font-bold text-slate-900 dark:text-white">LeadCRM</span>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  step < currentStep
                    ? 'bg-blue-600 text-white'
                    : step === currentStep
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                {step < currentStep ? <Check size={14} /> : step + 1}
              </div>
              {step < 2 && (
                <div className={`w-8 h-0.5 ${step < currentStep ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
              )}
            </div>
          ))}
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400">Step {currentStep + 1} of 3</div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">

          {/* ── Step 1: Workspace Setup ── */}
          {currentStep === 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/5 shadow-xl p-8">
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Building2 className="text-blue-600 dark:text-blue-400" size={28} aria-hidden="true" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Set up your workspace</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Tell us about your company to personalize your experience.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="company-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="company-name"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Acme Inc."
                  />
                </div>
                <div>
                  <label htmlFor="industry" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Industry <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="industry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Select industry</option>
                    {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="company-size" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Company Size <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="company-size"
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Select size</option>
                    {COMPANY_SIZES.map((size) => <option key={size} value={size}>{size} employees</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="timezone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Timezone</label>
                  <input
                    id="timezone"
                    type="text"
                    value={timezone}
                    readOnly
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-600 dark:text-slate-300 placeholder:text-slate-400"
                    placeholder="Auto-detected"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void handleSaveWorkspace(); }}
                disabled={isSaving || !companyName.trim() || !industry || !companySize}
                className="w-full mt-6 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isSaving ? 'Saving...' : 'Continue'}
                {!isSaving && <ChevronRight size={18} aria-hidden="true" />}
              </button>
            </div>
          )}

          {/* ── Step 2: Invite Team ── */}
          {currentStep === 1 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/5 shadow-xl p-8">
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Users className="text-purple-600 dark:text-purple-400" size={28} aria-hidden="true" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Invite your team</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Collaboration makes everything better. Add teammates to get started together.</p>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
                  className="flex-1 px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                  placeholder="teammate@company.com"
                  aria-label="Team member email"
                />
                <button
                  type="button"
                  onClick={handleAddEmail}
                  disabled={!inviteEmail.trim()}
                  className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                  aria-label="Add email"
                >
                  <Plus size={20} aria-hidden="true" />
                </button>
              </div>

              {inviteEmails.length > 0 && (
                <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
                  {inviteEmails.map((email) => (
                    <div key={email} className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-lg">
                      <span className="text-sm text-slate-700 dark:text-slate-300">{email}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEmail(email)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        aria-label={`Remove ${email}`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {inviteEmails.length === 0 && (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
                  No team members added yet. Add emails above or skip this step.
                </div>
              )}

              {invitesSent && (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg text-sm text-green-700 dark:text-green-300 text-center">
                  Invitations sent successfully!
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setCurrentStep(0)} className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl transition-colors flex items-center gap-2">
                  <ArrowLeft size={16} aria-hidden="true" /> Back
                </button>
                <button type="button" onClick={() => { void handleSkipInvite(); }} className="flex-1 py-3 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                  <SkipForward size={16} aria-hidden="true" /> Skip for now
                </button>
                <button type="button" onClick={() => { void handleSendInvitations(); }} disabled={isSendingInvites || inviteEmails.length === 0} className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
                  {isSendingInvites ? 'Sending...' : 'Send & Continue'}
                  {!isSendingInvites && <ChevronRight size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Quick Tour ── */}
          {currentStep === 2 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/5 shadow-xl p-8">
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Rocket className="text-emerald-600 dark:text-emerald-400" size={28} aria-hidden="true" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">You&apos;re all set!</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Here&apos;s what you can do with LeadCRM. Dive in when you&apos;re ready.</p>
              </div>

              <div className="space-y-4 mb-8">
                {[
                  { icon: '👥', title: 'Contacts & Leads', description: 'Import, organize, and manage all your business relationships in one place.' },
                  { icon: '📊', title: 'Sales Pipeline', description: 'Visualize your deals on a kanban board and track progress through every stage.' },
                  { icon: '📧', title: 'Campaigns', description: 'Send targeted email campaigns to engage prospects and close deals faster.' },
                  { icon: '⚡', title: 'Automation', description: 'Set up workflows to automate repetitive tasks and never miss a follow-up.' },
                ].map((feature) => (
                  <div key={feature.title} className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5 rounded-xl">
                    <span className="text-2xl" role="img" aria-label={feature.title}>{feature.icon}</span>
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white text-sm">{feature.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{feature.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setCurrentStep(1)} className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl transition-colors flex items-center gap-2">
                  <ArrowLeft size={16} aria-hidden="true" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => { void handleComplete(); }}
                  disabled={isSaving}
                  className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {isSaving ? 'Finishing...' : 'Get Started'}
                  {!isSaving && <Rocket size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
