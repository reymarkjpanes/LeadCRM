// ─── Invitation types — matches backend listPendingInvitations() response ─────

export interface PendingInvitation {
  id: string;
  email: string;
  roleName: string;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationValidationResult {
  valid: boolean;
  error?: 'not_found' | 'expired' | 'revoked' | 'already_accepted';
  invitation?: {
    email: string;
    roleId: string;
    role: { id: string; name: string };
    tenant: { name: string };
  };
}

export interface CreateInvitationResult {
  sent: string[];
  skipped: Array<{ email: string; reason: string }>;
}
