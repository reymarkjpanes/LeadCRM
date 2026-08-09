'use client';

import { apiClient } from '@/lib/api/client';
import type { User } from '@/store/types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: Pick<User, 'id' | 'email' | 'role' | 'firstName' | 'lastName' | 'tenantId'> & {
      status?:             string;
      tenantStatus?:       string;   // 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
      subscriptionStatus?: string;   // 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'
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

  registerClientAdmin: (payload: any) =>
    apiClient.post<AuthResponse>('/auth/register/client-admin', payload),

  registerGuest: (payload: any) =>
    apiClient.post<AuthResponse>('/auth/register/guest', payload),

  forgotPassword: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/reset-password', { token, password }),

  sendOtp: (email: string, password: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/send-otp', { email, password }),

  verifyOtp: (email: string, code: string) =>
    apiClient.post<AuthResponse>('/auth/verify-otp', { email, code }),

  sendRegistrationOtp: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/send-registration-otp', { email }),

  verifyRegistrationOtp: (email: string, code: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/verify-registration-otp', { email, code }),

  /**
   * Called after NextAuth completes the Google OAuth flow.
   * The backend /auth/oauth/google endpoint already set the LeadCRM
   * HttpOnly cookie during the NextAuth signIn callback — this call
   * to /auth/me simply re-hydrates the AuthContext state from that cookie.
   */
  refreshSession: () =>
    apiClient.get<AuthResponse>('/auth/me'),

  /**
   * Patches the tenant record for a new Google OAuth user who needs to
   * complete their company profile. tenantId is read from the server-side
   * session cookie — never from the request body.
   * Returns tenantStatus so the frontend can route to sandbox vs production.
   */
  completeOAuthProfile: (payload: {
    companyName:  string;
    industry:     string;
    companySize:  string;
    country:      string;
  }) =>
    apiClient.patch<{
      success: boolean;
      data: {
        tenantStatus:       string;   // 'SANDBOX' | 'ACTIVE' …
        subscriptionStatus: string;
      };
    }>('/auth/oauth/complete-profile', payload),
};
