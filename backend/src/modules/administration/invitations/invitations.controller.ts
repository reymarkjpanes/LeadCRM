import { Request, Response, NextFunction } from 'express';
import { CreateInvitationsSchema } from './invitations.dto';
import { createInvitations, listPendingInvitations, revokeInvitation, validateInvitationToken } from './invitations.service';

/**
 * GET /api/v1/invitations/validate/:token
 * Public endpoint — no auth required.
 * Validates an invitation token and returns display info for the accept form.
 * Read-only — does NOT consume the token.
 */
export async function validateInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token as string | undefined;

    if (!token || typeof token !== 'string') {
      res.json({ success: true, data: { valid: false, error: 'not_found' } });
      return;
    }

    const result = await validateInvitationToken(token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/invitations
 * Creates invitations and sends emails to the specified addresses.
 * Requires 'users.create' permission (checked by rbac middleware).
 */
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CreateInvitationsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Validation failed' });
      return;
    }

    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const result = await createInvitations(tenantId, userId, parsed.data.emails, parsed.data.roleId);

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/invitations
 * Lists all pending invitations for the authenticated user's tenant.
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const invitations = await listPendingInvitations(tenantId);

    res.json({ success: true, data: invitations });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/invitations/:id
 * Revokes an invitation (sets revokedAt, does not delete).
 */
export async function revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const invitationId = req.params.id as string;

    if (!invitationId) {
      res.status(400).json({ success: false, error: 'Invitation ID is required' });
      return;
    }

    await revokeInvitation(invitationId, tenantId);

    res.json({ success: true, message: 'Invitation revoked.' });
  } catch (err) {
    next(err);
  }
}
