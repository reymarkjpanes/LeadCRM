'use client';

import { apiClient } from '@/lib/api/client';
import type { User } from '@/store/types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  companyName: string;
  industry?: string;
  companySize?: string;
  businessWebsite?: string;
  acceptTerms?: boolean;
  invitationToken?: string;
  country?: string;
}

export interface RegisterResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      role: string;
      tenantId: string;
      emailSent: boolean;
    };
  };
}

export interface VerifyOtpResponse {
  success: boolean;
  message: string;
  data?: {
    user: Pick<User, 'id' | 'email' | 'role' | 'firstName' | 'lastName' | 'tenantId'>;
    redirectTo: string;
  };
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: Pick<User, 'id' | 'email' | 'role' | 'firstName' | 'lastName' | 'tenantId'> & {
      emailVerified?: string | null;
      onboardingStep?: number;
      onboardingCompletedAt?: string | null;
      tenantName?: string | null;
      industry?: string | null;
      companySize?: string | null;
    };
  };
}

export interface OnboardingStatusResponse {
  success: boolean;
  data: {
    step: number;
    completedAt: string | null;
    tenant: {
      name: string;
      industry: string | null;
      companySize: string | null;
    };
  };
}

/**
 * authApi — calls the real Express backend.
 * Used by AuthContext when NEXT_PUBLIC_USE_MOCK_AUTH !== 'true'.
 */
export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.post<AuthResponse>('/auth/login', payload),

  logout: () =>
    apiClient.post<{ success: boolean }>('/auth/logout', {}),

  me: () =>
    apiClient.get<AuthResponse>('/auth/me'),

  registerClientAdmin: (payload: RegisterPayload) =>
    apiClient.post<RegisterResponse>('/auth/register/client-admin', payload),

  registerGuest: (payload: RegisterPayload) =>
    apiClient.post<RegisterResponse>('/auth/register/guest', payload),

  sendRegistrationOtp: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/send-registration-otp', { email }),

  verifyRegistrationOtp: (email: string, code: string) =>
    apiClient.post<VerifyOtpResponse>('/auth/verify-registration-otp', { email, code }),

  resendVerification: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/resend-verification', { email }),

  forgotPassword: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/reset-password', { token, password }),

  // ── Onboarding ──────────────────────────────────────────────────────────────
  getOnboardingStatus: () =>
    apiClient.get<OnboardingStatusResponse>('/auth/onboarding/status'),

  saveOnboardingWorkspace: (payload: { companyName: string; industry: string; companySize: string; timezone?: string }) =>
    apiClient.patch<{ success: boolean }>('/auth/onboarding/workspace', payload),

  updateOnboardingStep: (step: number) =>
    apiClient.patch<{ success: boolean }>('/auth/onboarding/step', { step }),

  completeOnboarding: () =>
    apiClient.post<{ success: boolean; message: string }>('/auth/onboarding/complete', {}),

  // ── Invitations ─────────────────────────────────────────────────────────────
  sendInvitations: (emails: string[], roleId: string) =>
    apiClient.post<{ success: boolean; data: { sent: string[]; skipped: Array<{ email: string; reason: string }> } }>('/invitations', { emails, roleId }),

  listInvitations: () =>
    apiClient.get<{ success: boolean; data: Array<{ id: string; email: string; roleName: string; invitedBy: string; expiresAt: string; createdAt: string }> }>('/invitations'),

  revokeInvitation: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/invitations/${id}`),

  /**
   * Called after NextAuth completes the Google OAuth flow.
   */
  refreshSession: () =>
    apiClient.get<AuthResponse>('/auth/me'),

  /**
   * Patches the tenant record for a new Google OAuth user who needs to
   * complete their company profile.
   */
  completeOAuthProfile: (payload: {
    companyName:  string;
    industry:     string;
    companySize:  string;
    country?:     string;
  }) =>
    apiClient.patch<{ success: boolean }>('/auth/oauth/complete-profile', payload),

  /**
   * Get sandbox email configuration for testing.
   */
  getSandboxInfo: () =>
    apiClient.get<{ success: boolean; data: { isSandboxMode: boolean; allowedEmails: string[]; isDevelopment: boolean } }>('/auth/sandbox-info'),

  /**
   * Check if an email is already registered
   */
  checkEmail: (email: string) =>
    apiClient.get<{ success: boolean; data: { exists: boolean } }>(`/auth/check-email?email=${encodeURIComponent(email)}`),
};
