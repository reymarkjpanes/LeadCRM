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
  correspondent,
  messageReadState,
  threadReadState,
  threadArchive,
  threadTrash,
  associateDeal,
  schedule,
  scheduledDetail,
  cancelScheduled,
  attachment,
} from '../../integrations/gmail/gmail.controller';

import { workspaceReadyMiddleware } from '../middleware/tenant.middleware';
import { authorize as requirePermission, authorizeAny } from '../middleware/rbac.middleware';
import { mailboxPermissions } from '../../integrations/gmail/mailbox-sync.service';
import { mailboxEvents } from '../../integrations/gmail/mailbox-events';

const router = Router();
router.get('/gmail/callback', callback);
router.use('/gmail', authMiddleware, workspaceReadyMiddleware, authorizeAny('leads.view', 'contacts.view'), async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // Expired test access must still allow status, reconnect and token removal.
  const checkOwnership = !['/status', '/authorize', '/disconnect'].includes(req.path);
  try { await mailboxPermissions(req.user!.tenantId, req.user!.userId, checkOwnership); next(); } catch (error) { next(error); }
});
router.post('/gmail/sync', sync);
router.get('/gmail/events', mailboxEvents);
router.post('/gmail/scheduled', schedule);
router.get('/gmail/scheduled/:id', scheduledDetail);
router.post('/gmail/scheduled/:id/cancel', cancelScheduled);
router.get('/gmail/threads/:threadId', thread);
router.get('/gmail/conversations/:conversationId', correspondent);
router.patch('/gmail/messages/:messageId/read-state', messageReadState);
router.get('/gmail/messages/:messageId/attachments/:attachmentId', attachment);
router.patch('/gmail/threads/:threadId/read-state', threadReadState);
router.post('/gmail/threads/:threadId/archive', threadArchive);
router.post('/gmail/threads/:threadId/trash', threadTrash);
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
