import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  authorize,
  callback,
  status,
  listEmails,
  unreadCount,
  send,
  disconnect,
  trash,
  archive,
  saveDraftHandler,
  deleteDraftHandler,
  sync,
  thread,
  associateDeal,
} from '../../integrations/gmail/gmail.controller';

import { workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize as requirePermission, authorizeAny } from '../middleware/rbac.middleware';
import { mailboxPermissions } from '../../integrations/gmail/mailbox-sync.service';

const router = Router();
router.get('/gmail/callback', callback);
router.use('/gmail', authMiddleware, workspaceReadyMiddleware, authorizeAny('leads.view', 'contacts.view'), async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // Expired test access must still allow status, reconnect and token removal.
  const checkOwnership = !['/status', '/authorize', '/disconnect'].includes(req.path);
  try { await mailboxPermissions(req.user!.tenantId, req.user!.userId, checkOwnership); next(); } catch (error) { next(error); }
});
router.post('/gmail/sync', sync);
router.get('/gmail/threads/:threadId', thread);
router.patch('/gmail/threads/:threadId/deal', requirePermission('deals.edit'), associateDeal);

// ── Gmail Integration ─────────────────────────────────
// GET  /integrations/gmail/authorize   — get OAuth URL (authenticated)
// GET  /integrations/gmail/callback    — OAuth callback from Google (no auth — state-validated)
// GET  /integrations/gmail/status      — connection status (authenticated)
// GET  /integrations/gmail/emails      — fetch inbox emails (authenticated)
// POST /integrations/gmail/send        — send email (authenticated)
// POST /integrations/gmail/disconnect  — disconnect account (authenticated)

router.get('/gmail/authorize', authorize);
router.get('/gmail/status', status);
router.get('/gmail/emails', listEmails);
router.get('/gmail/unread-count', unreadCount);
router.post('/gmail/send', send);
router.post('/gmail/disconnect', disconnect);
router.post('/gmail/trash', trash);
router.post('/gmail/archive', archive);
router.post('/gmail/drafts', saveDraftHandler);
router.delete('/gmail/drafts/:draftId', deleteDraftHandler);

export default router;
