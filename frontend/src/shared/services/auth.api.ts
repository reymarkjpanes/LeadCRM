'use client';

import { apiClient } from '@/lib/api/client';
import type { AuthResponse } from '@leadcrm/shared';
export type { AuthResponse } from '@leadcrm/shared';

export type LoginPayload = import('@leadcrm/shared').LoginInput;

/**
 * authApi — calls the real Express backend.
 * Used by AuthContext when NEXT_PUBLIC_USE_MOCK_AUTH !== 'true'.
 */
export const authApi = {
  updateProfile: (profile: import('@leadcrm/shared').UpdateSelfProfile) =>
    apiClient.patch<AuthResponse>('/auth/profile', profile),
  requestProfileEmailChange: (payload: { email: string; currentPassword: string }) =>
    apiClient.post<{ success: boolean }>('/auth/profile/email/request', payload),
  confirmProfileEmailChange: (payload: { code: string }) =>
    apiClient.post<{ success: boolean }>('/auth/profile/email/confirm', payload),
  uploadAvatar: (file: Blob) => apiClient.upload<AuthResponse>('/auth/profile/avatar', file),
  login: (payload: LoginPayload) =>
    apiClient.post<import('@leadcrm/shared').LoginResponse>('/auth/login', payload),

  restoreLoginLockout: (email?: string) =>
    apiClient.post<import('@leadcrm/shared').LoginLockoutResponse>('/auth/login-lockout', email ? { email } : {}),

  changePassword: (payload: import('@leadcrm/shared').ChangePasswordInput | import('@leadcrm/shared').MandatoryPasswordChangeInput) =>
    apiClient.post<AuthResponse>('/auth/change-password', payload),


  logout: (sessionId?: string) =>
    apiClient.post<{ success: boolean }>('/auth/logout', sessionId ? { sessionId } : {}),

  me: () =>
    apiClient.get<AuthResponse>('/auth/me'),

  forgotPassword: (email: string) =>
    apiClient.post<import('@leadcrm/shared').PasswordRecoveryResponse>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/reset-password', { token, password }),

  completeOnboarding: () =>
    apiClient.post<AuthResponse>('/auth/onboarding/complete', {}),

};
