'use client';

import { apiClient } from '@/lib/api/client';
import type { AuthResponse } from '@leadcrm/shared';
export type { AuthResponse } from '@leadcrm/shared';

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * authApi — calls the real Express backend.
 * Used by AuthContext when NEXT_PUBLIC_USE_MOCK_AUTH !== 'true'.
 */
export const authApi = {
  updateProfile: (profile: import('@leadcrm/shared').UpdateSelfProfile) =>
    apiClient.patch<AuthResponse>('/auth/profile', profile),
  uploadAvatar: (file: Blob) => apiClient.upload<AuthResponse>('/auth/profile/avatar', file),
  login: (payload: LoginPayload) =>
    apiClient.post<import('@leadcrm/shared').LoginResponse>('/auth/login', payload),

  changePassword: (payload: import('@leadcrm/shared').ChangePasswordInput) =>
    apiClient.post<AuthResponse>('/auth/change-password', payload),


  logout: () =>
    apiClient.post<{ success: boolean }>('/auth/logout', {}),

  me: () =>
    apiClient.get<AuthResponse>('/auth/me'),

  forgotPassword: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<{ success: boolean; message: string }>('/auth/reset-password', { token, password }),

  completeOnboarding: () =>
    apiClient.post<AuthResponse>('/auth/onboarding/complete', {}),

};
