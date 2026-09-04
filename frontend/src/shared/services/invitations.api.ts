'use client';

import { apiClient } from '@/lib/api/client';
import type { PendingInvitation, CreateInvitationResult, InvitationValidationResult } from '@/store/types/invitation.types';

/**
 * invitationsApi — real API client for the /invitations endpoints.
 * All mutations require users.manage permission (enforced server-side).
 */
export const invitationsApi = {
  /**
   * List all pending (non-expired, non-revoked, non-accepted) invitations for
   * the authenticated user's tenant.
   */
  list: (): Promise<{ success: boolean; data: PendingInvitation[] }> =>
    apiClient.get('/invitations'),

  /**
   * Send invitations to one or more email addresses with the given role.
   * The backend sends invitation emails and returns sent/skipped lists.
   */
  create: (emails: string[], roleId: string): Promise<{ success: boolean; data: CreateInvitationResult }> =>
    apiClient.post('/invitations', { emails, roleId }),

  /**
   * Revoke a pending invitation by ID (sets revokedAt — does not delete).
   */
  revoke: (id: string): Promise<{ success: boolean; message?: string }> =>
    apiClient.delete(`/invitations/${id}`),

  /**
   * Validate an invitation token (public endpoint — no auth required).
   * Read-only — does NOT consume the token.
   */
  validate: (token: string): Promise<{ success: boolean; data: InvitationValidationResult }> =>
    apiClient.get(`/invitations/validate/${encodeURIComponent(token)}`),
};
