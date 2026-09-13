'use client';

import { apiClient } from '@/lib/api/client';
import type { TenantVerificationState, VerificationDocument, BusinessType } from '@/features/tenant/billing/types/verification.types';

const IS_BROWSER = typeof window !== 'undefined';
const DIRECT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const USE_PROXY = IS_BROWSER && DIRECT_API_URL.startsWith('https://') && !DIRECT_API_URL.includes('localhost');
const API_URL = USE_PROXY ? '/api/proxy' : DIRECT_API_URL;

export const verificationApi = {
  getVerificationStatus: (): Promise<{ success: boolean; data: TenantVerificationState }> =>
    apiClient.get<{ success: boolean; data: TenantVerificationState }>('/billing/verification'),

  uploadDocument: async (documentKey: string, file: File): Promise<{ success: boolean; data: { document: VerificationDocument } }> => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentKey', documentKey);
    const res = await fetch(`${API_URL}/billing/verification/documents`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const msg = (errorData?.error as Record<string, unknown>)?.message as string ?? 'Failed to upload document';
      throw new Error(msg);
    }
    return res.json();
  },

  deleteDocument: (documentKey: string): Promise<{ success: boolean }> =>
    apiClient.delete<{ success: boolean }>(`/billing/verification/documents/${documentKey}`),

  submitVerification: (businessType: BusinessType): Promise<{ success: boolean; data: { verificationStatus: string } }> =>
    apiClient.post('/billing/verification/submit', { businessType }),

  getDocumentFileUrl: (documentKey: string): string =>
    `${API_URL}/billing/verification/documents/${documentKey}/file`,
};
