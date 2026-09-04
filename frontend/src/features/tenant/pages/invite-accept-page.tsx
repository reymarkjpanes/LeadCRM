'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Building2, ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invitationsApi } from '@/shared/services/invitations.api';
import { authApi } from '@/shared/services/auth.api';
import { useAuth } from '@/store/AuthContext';
import type { InvitationValidationResult } from '@/store/types/invitation.types';

// ── Form schema ───────────────────────────────────────────────────────────────
const acceptInviteSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(50, 'First name is too long'),
    lastName:  z.string().min(1, 'Last name is required').max(50, 'Last name is too long'),
    password:  z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~])/,
        'Password must contain uppercase, lowercase, number and special character',
      ),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      });
    }
  });

type AcceptInviteFormValues = z.infer<typeof acceptInviteSchema>;

// ── Validation error state display ────────────────────────────────────────────
type TokenErrorState = 'not_found' | 'expired' | 'revoked' | 'already_accepted' | 'network_error';

const TOKEN_ERROR_MESSAGES: Record<TokenErrorState, { title: string; body: string }> = {
  not_found:        { title: 'Invalid invitation link', body: 'This invitation link is invalid or does not exist.' },
  expired:          { title: 'Invitation expired', body: 'This invitation has expired. Ask your administrator to send a new one.' },
  revoked:          { title: 'Invitation cancelled', body: 'This invitation has been revoked by the administrator.' },
  already_accepted: { title: 'Already accepted', body: 'This invitation has already been used to create an account.' },
  network_error:    { title: 'Connection error', body: 'Unable to validate the invitation. Check your network and try again.' },
};

interface InviteAcceptPageProps {
  token: string;
}

export default function InviteAcceptPage({ token }: InviteAcceptPageProps): React.ReactElement {
  const router = useRouter();
  const { login } = useAuth();

  const [validationState, setValidationState] = useState<'loading' | 'valid' | 'error'>('loading');
  const [tokenError, setTokenError] = useState<TokenErrorState | null>(null);
  const [invitationInfo, setInvitationInfo] = useState<InvitationValidationResult['invitation'] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(acceptInviteSchema),
  });

  // ── Validate token on mount ───────────────────────────────────────────────
  const validateToken = useCallback(async (): Promise<void> => {
    if (!token || token.trim() === '') {
      setTokenError('not_found');
      setValidationState('error');
      return;
    }
    try {
      const res = await invitationsApi.validate(token);
      if (res?.data?.valid && res.data.invitation) {
        setInvitationInfo(res.data.invitation);
        setValidationState('valid');
      } else {
        setTokenError((res?.data?.error as TokenErrorState) ?? 'not_found');
        setValidationState('error');
      }
    } catch {
      setTokenError('network_error');
      setValidationState('error');
    }
  }, [token]);

  useEffect(() => {
    void validateToken();
  }, [validateToken]);

  // ── Form submit ───────────────────────────────────────────────────────────
  const onSubmit = async (values: AcceptInviteFormValues): Promise<void> => {
    if (!invitationInfo) return;
    setIsSubmitting(true);
    try {
      // Call the client-admin registration endpoint with the invitation token.
      // companyName is optional when invitationToken is present (backend validates this).
      await authApi.registerClientAdmin({
        firstName:       values.firstName,
        lastName:        values.lastName,
        email:           invitationInfo.email,
        password:        values.password,
        companyName:     invitationInfo.tenant.name, // tenant name from invitation — satisfies optional field
        invitationToken: token,
        acceptTerms:     true,
      });

      // Registration succeeded — send OTP to complete email verification.
      // The invitee is now PENDING until they verify their email.
      setIsSuccess(true);

      // Auto-trigger OTP send so the user can verify immediately
      await authApi.sendRegistrationOtp(invitationInfo.email).catch(() => {
        // Non-critical — user can request resend from the verify-email page
      });

      toast.success('Account created! Check your email to verify your account.');

      // Redirect to email verification page
      setTimeout(() => {
        router.push(`/verify-email?email=${encodeURIComponent(invitationInfo.email)}`);
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (validationState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-lg text-center">
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Validating your invitation…</p>
          {/* Skeleton lines */}
          <div className="mt-6 space-y-3">
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full w-3/4 mx-auto animate-pulse" />
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full w-1/2 mx-auto animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (validationState === 'error' && tokenError) {
    const { title, body } = TOKEN_ERROR_MESSAGES[tokenError];
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-500 dark:text-red-400" aria-hidden />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{title}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{body}</p>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 dark:text-emerald-400" aria-hidden />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Account created!</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Redirecting to email verification…</p>
        </div>
      </div>
    );
  }

  // ── Accept form ───────────────────────────────────────────────────────────
  const info = invitationInfo!;
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Context card — who invited you */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-lg mb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
              <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">You are joining</p>
              <p className="text-base font-bold text-slate-900 dark:text-white">{info.tenant.name}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Role: <span className="font-semibold text-slate-700 dark:text-slate-300">{info.role.name}</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Invited email: <span className="font-medium text-slate-600 dark:text-slate-400">{info.email}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-lg">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create your account</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Fill in your details to accept the invitation.
          </p>

          <form onSubmit={handleSubmit((v) => void onSubmit(v))} noValidate className="space-y-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  {...register('firstName')}
                  className={cn(
                    'w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors',
                    errors.firstName
                      ? 'border-red-400 dark:border-red-500 focus:ring-red-400/30'
                      : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/30 focus:border-blue-400',
                  )}
                  placeholder="Alice"
                />
                {errors.firstName && (
                  <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.firstName.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  {...register('lastName')}
                  className={cn(
                    'w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors',
                    errors.lastName
                      ? 'border-red-400 dark:border-red-500 focus:ring-red-400/30'
                      : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/30 focus:border-blue-400',
                  )}
                  placeholder="Johnson"
                />
                {errors.lastName && (
                  <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.lastName.message}</p>
                )}
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                className={cn(
                  'w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors',
                  errors.password
                    ? 'border-red-400 dark:border-red-500 focus:ring-red-400/30'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/30 focus:border-blue-400',
                )}
                placeholder="Min. 8 characters"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
                className={cn(
                  'w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors',
                  errors.confirmPassword
                    ? 'border-red-400 dark:border-red-500 focus:ring-red-400/30'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/30 focus:border-blue-400',
                )}
                placeholder="Repeat password"
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-500 dark:text-red-400">{errors.confirmPassword.message}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_4px_15px_rgba(59,130,246,0.3)] mt-2"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {isSubmitting ? 'Creating account…' : 'Accept Invitation'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
