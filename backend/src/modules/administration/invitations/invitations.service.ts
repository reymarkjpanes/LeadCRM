import crypto from 'crypto';
import prisma from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { sendMail, buildInvitationEmail } from '../../../shared/services/email.service';

const INVITATION_TTL_DAYS = parseInt(process.env.INVITATION_TOKEN_TTL_DAYS ?? '7', 10);

export interface CreateInvitationResult {
  sent: string[];
  skipped: Array<{ email: string; reason: string }>;
}

/**
 * Creates TenantInvitation records and sends invitation emails.
 * Skips emails that already belong to a tenant member or have a pending invitation.
 */
export async function createInvitations(
  tenantId: string,
  invitedById: string,
  emails: string[],
  roleId: string,
): Promise<CreateInvitationResult> {
  const sent: string[] = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  // Validate role exists for this tenant
  const role = await prisma.roleDefinition.findFirst({
    where: { id: roleId, tenantId },
    select: { id: true, name: true },
  });

  if (!role) {
    throw new AppError('Role not found for this tenant.', 400);
  }

  // Fetch inviter name for email template
  const inviter = await prisma.user.findFirst({
    where: { id: invitedById, tenantId },
    select: { firstName: true, lastName: true },
  });
  const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Your teammate';

  // Fetch tenant name for email template
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { name: true },
  });
  const tenantName = tenant?.name ?? 'LeadCRM Workspace';

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  for (const rawEmail of emails) {
    const email = rawEmail.toLowerCase().trim();

    // Check if user already exists in this tenant
    const existingUser = await prisma.user.findFirst({
      where: { email, tenantId },
    });

    if (existingUser) {
      skipped.push({ email, reason: 'User is already a member of this workspace' });
      continue;
    }

    // Check if a pending invitation already exists
    const existingInvitation = await prisma.tenantInvitation.findFirst({
      where: {
        email,
        tenantId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvitation) {
      skipped.push({ email, reason: 'An invitation is already pending for this email' });
      continue;
    }

    // Generate invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Create invitation record
    await prisma.tenantInvitation.create({
      data: {
        tenantId,
        email,
        roleId,
        token,
        invitedById,
        expiresAt,
      },
    });

    // Build invitation URL — points to the dedicated accept page
    const inviteUrl = `${appUrl}/invite/accept?token=${token}`;

    // Send invitation email (non-blocking per email — continue even if one fails)
    try {
      await sendMail({
        to: email,
        subject: `${inviterName} invited you to join ${tenantName} on LeadCRM`,
        html: buildInvitationEmail(inviterName, tenantName, inviteUrl, role.name),
      });
      sent.push(email);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // eslint-disable-next-line no-console
      console.error(`[Invitations] Failed to send to ${email}:`, message);
      // Still count as sent since the invitation record was created
      sent.push(email);
    }
  }

  return { sent, skipped };
}

/**
 * Lists pending (not accepted, not revoked, not expired) invitations for a tenant.
 */
export async function listPendingInvitations(tenantId: string) {
  const invitations = await prisma.tenantInvitation.findMany({
    where: {
      tenantId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      role: { select: { name: true } },
      invitedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    roleName: inv.role?.name ?? 'Unknown',
    invitedBy: inv.invitedBy ? `${inv.invitedBy.firstName} ${inv.invitedBy.lastName}` : 'Unknown',
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }));
}

/**
 * Revokes an invitation (sets revokedAt — doesn't delete for audit trail).
 */
export async function revokeInvitation(invitationId: string, tenantId: string): Promise<void> {
  const invitation = await prisma.tenantInvitation.findFirst({
    where: { id: invitationId, tenantId, acceptedAt: null, revokedAt: null },
  });

  if (!invitation) {
    throw new AppError('Invitation not found or already used.', 404);
  }

  await prisma.tenantInvitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });
}

// ── Token validation result type ─────────────────────────────────────────

export type InvitationValidationError = 'not_found' | 'expired' | 'revoked' | 'already_accepted';

export interface InvitationValidationResult {
  valid: boolean;
  error?: InvitationValidationError;
  invitation?: {
    email: string;
    roleId: string;
    role: { id: string; name: string };
    tenant: { name: string };
  };
}

/**
 * Validates an invitation token without consuming it (read-only).
 *
 * Tokens are stored raw (not hashed) in TenantInvitation.token.
 * Returns a structured result suitable for rendering the accept form.
 * Exposes only: email, role name + id, tenant name — no internal IDs beyond roleId.
 */
export async function validateInvitationToken(token: string): Promise<InvitationValidationResult> {
  if (!token || token.length < 16) {
    return { valid: false, error: 'not_found' };
  }

  const invitation = await prisma.tenantInvitation.findFirst({
    where: { token },
    include: {
      role:   { select: { id: true, name: true } },
      tenant: { select: { name: true } },
    },
  });

  if (!invitation) {
    return { valid: false, error: 'not_found' };
  }

  if (invitation.revokedAt) {
    return { valid: false, error: 'revoked' };
  }

  if (invitation.acceptedAt) {
    return { valid: false, error: 'already_accepted' };
  }

  if (invitation.expiresAt < new Date()) {
    return { valid: false, error: 'expired' };
  }

  return {
    valid: true,
    invitation: {
      email:    invitation.email,
      roleId:   invitation.roleId,
      role:     { id: invitation.role.id, name: invitation.role.name },
      tenant:   { name: invitation.tenant.name },
    },
  };
}
