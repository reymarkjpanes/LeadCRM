'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuth } from '@/store/AuthContext';
import { authApi } from '@/shared/services/auth.api';
import { ArrowRight, Building2, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

// ─── Validation schema ────────────────────────────────────────────────────────
// Mirrors the backend ClientAdminRegisterSchema fields that are missing
// after a Google OAuth sign-up (company details were not collected during OAuth).
const completeProfileSchema = z.object({
  companyName:  z.string().min(2, 'Company name must be at least 2 characters'),
  industry:     z.string().min(1, 'Please select an industry'),
  companySize:  z.string().min(1, 'Please select a company size'),
  country:      z.string().min(1, 'Please select a country'),
});

type CompleteProfileForm = z.infer<typeof completeProfileSchema>;

const INDUSTRIES = [
  'IT Solutions',
  'Software Development',
  'Cybersecurity',
  'Telecom',
  'Consulting',
  'Other',
];

const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '500+'];

const COUNTRIES = [
  'Philippines',
  'United States',
  'United Kingdom',
  'Singapore',
  'Australia',
  'Canada',
  'Other',
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * CompleteProfilePage
 *
 * Shown to new Google OAuth users who haven't filled in company details yet.
 * The backend already created their User + Tenant records with defaults —
 * this form patches those records with the missing business information.
 *
 * Route: /auth/complete-profile
 * Triggered by: NextAuth newUser page config + requiresProfileCompletion flag
 */
export default function CompleteProfilePage(): React.ReactElement {
  const router      = useRouter();
  const { data: session, status } = useSession();
  const { user }    = useAuth();

  const [form, setForm] = useState<CompleteProfileForm>({
    companyName:  '',
    industry:     '',
    companySize:  '',
    country:      '',
  });
  const [error,     setError]     = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Redirect away if user is not authenticated or doesn't need profile completion
  React.useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
    // If user already has a complete profile (e.g. navigated here directly)
    if (session && !session.requiresProfileCompletion && user) {
      router.replace('/dashboard');
    }
  }, [status, session, user, router]);

  const handleChange = (field: keyof CompleteProfileForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    const parsed = completeProfileSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Please fill in all required fields.');
      return;
    }

    setIsLoading(true);
    try {
      // Patch the tenant record with the company details the user just entered.
      // The backend reads tenantId from the authenticated session cookie — never
      // from the request body (tenant isolation is enforced server-side).
      const profileRes = await authApi.completeOAuthProfile(parsed.data);

      // Re-hydrate the session so AuthContext picks up the updated tenant name
      await authApi.refreshSession();

      toast.success('Profile completed! Welcome to LeadCRM.');

      // Hard navigate so AuthContext re-mounts and restoreSession re-runs
      // with the already-set leadcrm_token cookie.
      window.location.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Show nothing while session is loading to avoid layout flash
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md bg-blue-50 dark:bg-[#0A1931]/80 backdrop-blur-xl p-8 rounded-2xl border border-slate-800 shadow-2xl relative z-10">

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-[#0A6EFF] to-blue-500 rounded-xl flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(10,110,255,0.3)]">
            <Building2 className="text-white" size={22} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
            Complete your profile
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm text-center">
            Tell us a bit about your company to finish setting up your workspace.
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm flex items-start gap-2"
          >
            <span className="mt-0.5" aria-hidden="true">⚠️</span>
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>

          {/* Company Name */}
          <div>
            <label
              htmlFor="companyName"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Company Name <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="companyName"
              type="text"
              autoComplete="organization"
              required
              value={form.companyName}
              onChange={e => handleChange('companyName', e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700
                rounded-lg px-4 py-2.5 text-slate-900 dark:text-white text-sm
                placeholder:text-slate-400 focus:outline-none focus:border-[#0A6EFF] transition-colors"
            />
          </div>

          {/* Industry */}
          <div>
            <label
              htmlFor="industry"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Industry <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <select
              id="industry"
              required
              value={form.industry}
              onChange={e => handleChange('industry', e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700
                rounded-lg px-4 py-2.5 text-slate-900 dark:text-white text-sm
                focus:outline-none focus:border-[#0A6EFF] transition-colors"
            >
              <option value="" disabled>Select industry…</option>
              {INDUSTRIES.map(ind => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          </div>

          {/* Company Size */}
          <div>
            <label
              htmlFor="companySize"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Company Size <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <select
              id="companySize"
              required
              value={form.companySize}
              onChange={e => handleChange('companySize', e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700
                rounded-lg px-4 py-2.5 text-slate-900 dark:text-white text-sm
                focus:outline-none focus:border-[#0A6EFF] transition-colors"
            >
              <option value="" disabled>Select size…</option>
              {COMPANY_SIZES.map(size => (
                <option key={size} value={size}>{size} employees</option>
              ))}
            </select>
          </div>

          {/* Country */}
          <div>
            <label
              htmlFor="country"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Country <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <Globe
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                aria-hidden="true"
              />
              <select
                id="country"
                required
                value={form.country}
                onChange={e => handleChange('country', e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700
                  rounded-lg pl-9 pr-4 py-2.5 text-slate-900 dark:text-white text-sm
                  focus:outline-none focus:border-[#0A6EFF] transition-colors"
              >
                <option value="" disabled>Select country…</option>
                {COUNTRIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 h-10 bg-[#0A6EFF]
              hover:bg-blue-600 active:scale-[0.98] text-white text-sm font-semibold
              rounded-xl shadow-md shadow-blue-500/20 transition-all
              disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                Continue to Dashboard
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>

        </form>

        {/* Skip link — lets users bypass the form; they land in sandbox dashboard */}
        <button
          type="button"
          onClick={() => window.location.replace('/dashboard')}
          className="w-full mt-4 text-sm text-slate-400 dark:text-slate-500
            hover:text-slate-600 dark:hover:text-slate-300 text-center transition-colors"
        >
          Skip for now
        </button>

      </div>
    </div>
  );
}
