import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SendMailboxEmailSchema, SaveMailboxDraftSchema, MailboxListSchema, ScheduleMailboxEmailSchema, MailboxReadStateSchema, MailboxBulkActionSchema, MailboxConversationIdSchema } from '@leadcrm/shared';
import { mutateMailboxThread, mutateMailboxThreads, mutateMailboxCorrespondents, mutateMailboxMessages } from './mailbox-thread-actions';
import { readMailboxCorrespondent } from './mailbox-correspondents.service';
import { sendMailboxEmail } from './mailbox-send.service';
import { scheduleMailboxEmail, getScheduledMailboxEmail, cancelScheduledMailboxEmail } from './scheduled-mailbox.service';
import { fetchEmails, fetchUnreadCount, getConnectionStatus, disconnectAccount, trashEmails, archiveEmails, saveDraft, deleteDraft } from './gmail.service';
import { beginMailboxConnection, finishMailboxConnection } from './mailbox-auth.service';
import { syncMailbox, readMailboxThread, decorateEmails, mailboxPermissions, associateMailboxDeal } from './mailbox-sync.service';
import { AppError } from '../../shared/errors/app-error';
import { writeAuditLog } from '../../core/audit/audit.service';
import { readMailboxAttachment } from './mailbox-attachments';

const providerId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
export async function scheduledDetail(req: Request, res: Response, next: NextFunction) {
  try { res.json(await getScheduledMailboxEmail(req.user!.tenantId, req.user!.userId, z.string().uuid().parse(req.params.id))); }
  catch (error) { next(error); }
}
export async function cancelScheduled(req: Request, res: Response, next: NextFunction) {
  try { res.json(await cancelScheduledMailboxEmail(req.user!.tenantId, req.user!.userId, z.string().uuid().parse(req.params.id))); }
  catch (error) { next(error); }
}

export async function authorize(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.leadcrm_token ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new AppError('Authentication required.', 401);
    res.json(await beginMailboxConnection(req.user!, token));
  } catch (error) { next(error); }
}
export async function callback(req: Request, res: Response) {
  const destination = new URL('/inbox', process.env.APP_URL ?? 'http://localhost:3000');
  try {
    if (req.query.error) throw new AppError('Gmail connection was cancelled or denied. Try connecting again.', 400);
    const { state, code } = z.object({ state: z.string().min(20).max(200), code: z.string().min(1).max(4000) }).parse(req.query);
    await finishMailboxConnection(state, code);
    destination.searchParams.set('gmail_connected', 'true');
  } catch (error) {
    destination.searchParams.set('gmail_error', error instanceof AppError ? error.message : 'Gmail connection failed. Please reconnect from Messages.');
  }
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(destination.toString());
}
export async function status(req: Request, res: Response, next: NextFunction) {
  try { res.json(await getConnectionStatus(req.user!.tenantId, req.user!.userId)); } catch (error) { next(error); }
}
export async function listEmails(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, tenantId } = req.user!;
    const { scopeHash, ...result } = await fetchEmails(tenantId, userId, MailboxListSchema.parse(req.query));
    res.json({ ...result, emails: await decorateEmails(tenantId, userId, result.emails, await mailboxPermissions(tenantId, userId), scopeHash) });
  } catch (error) { next(error); }
}
export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try { res.json(await fetchUnreadCount(req.user!.tenantId, req.user!.userId)); } catch (error) { next(error); }
}
export async function sync(req: Request, res: Response, next: NextFunction) {
  try { res.json(await syncMailbox(req.user!.tenantId, req.user!.userId)); } catch (error) { next(error); }
}
export async function schedule(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await scheduleMailboxEmail(req.user!.tenantId, req.user!.userId, ScheduleMailboxEmailSchema.parse(req.body))); } catch (error) { next(error); }
}
export async function thread(req: Request, res: Response, next: NextFunction) {
  try { res.json(await readMailboxThread(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId))); } catch (error) { next(error); }
}
export async function correspondent(req: Request, res: Response, next: NextFunction) {
  try { res.json(await readMailboxCorrespondent(req.user!.tenantId, req.user!.userId, MailboxConversationIdSchema.parse(req.params.conversationId), req.query)); } catch (error) { next(error); }
}
export async function messageReadState(req: Request, res: Response, next: NextFunction) {
  try { const { isRead } = MailboxReadStateSchema.parse(req.body); res.json(await mutateMailboxMessages(req.user!.tenantId, req.user!.userId, [providerId.parse(req.params.messageId)], isRead ? 'read' : 'unread')); } catch (error) { next(error); }
}
export async function attachment(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await readMailboxAttachment(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.messageId), z.string().regex(/^[a-zA-Z0-9_-]+$/).max(2000).parse(req.params.attachmentId));
    const filename = file.filename.replace(/[\r\n/\\]/g, '_').slice(0, 1000) || 'attachment';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`);
    res.send(file.data);
  } catch (error) { next(error); }
}
export async function threadReadState(req: Request, res: Response, next: NextFunction) {
  try { const { isRead } = MailboxReadStateSchema.parse(req.body); res.json(await mutateMailboxThread(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId), isRead ? 'read' : 'unread')); } catch (error) { next(error); }
}
export async function threadArchive(req: Request, res: Response, next: NextFunction) {
  try { res.json(await mutateMailboxThread(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId), 'archive')); } catch (error) { next(error); }
}
export async function threadTrash(req: Request, res: Response, next: NextFunction) {
  try { res.json(await mutateMailboxThread(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId), 'trash')); } catch (error) { next(error); }
}
export async function associateDeal(req: Request, res: Response, next: NextFunction) {
  try { const { dealId } = z.object({ dealId: z.string().min(1).max(200) }).strict().parse(req.body); res.json(await associateMailboxDeal(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId), dealId)); } catch (error) { next(error); }
}
export async function send(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, tenantId } = req.user!;
    const data = SendMailboxEmailSchema.parse(req.body);
    const result = await sendMailboxEmail(tenantId, userId, data);
    // A sync failure after Gmail accepted the send must not invite a duplicate send.
    let syncPending = false;
    try { await readMailboxThread(tenantId, userId, result.threadId); } catch { syncPending = true; }
    res.json({ success: true, ...result, syncPending });
  } catch (error) { next(error); }
}
export async function disconnect(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, tenantId } = req.user!;
    await disconnectAccount(tenantId, userId);
    await writeAuditLog({ tenantId, userId, action: 'integration.gmail_disconnected', entityType: 'EmailAccount', entityId: userId });
    res.json({ success: true, message: 'Work email disconnected. Saved CRM history is preserved.' });
  } catch (error) { next(error); }
}
async function bulkAction(req: Request, res: Response, next: NextFunction, action: 'archive' | 'trash') {
  try {
    const data = MailboxBulkActionSchema.parse(req.body), { tenantId, userId } = req.user!;
    res.json(await ('conversationIds' in data ? mutateMailboxCorrespondents(tenantId, userId, data.conversationIds, action) :
      'threadIds' in data ? mutateMailboxThreads(tenantId, userId, data.threadIds, action) :
        (action === 'trash' ? trashEmails : archiveEmails)(tenantId, userId, data.messageIds)));
  } catch (error) { next(error); }
}
export const trash = (req: Request, res: Response, next: NextFunction) => bulkAction(req, res, next, 'trash');
export const archive = (req: Request, res: Response, next: NextFunction) => bulkAction(req, res, next, 'archive');
export async function saveDraftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = SaveMailboxDraftSchema.parse(req.body);
    res.json({ success: true, ...await saveDraft(req.user!.tenantId, req.user!.userId, data.to, data.subject, data.body, data.draftId, { replyToMessageId: data.replyToMessageId, forwardSourceMessageId: data.forwardSourceMessageId }) });
  } catch (error) { next(error); }
}
export async function deleteDraftHandler(req: Request, res: Response, next: NextFunction) {
  try { await deleteDraft(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.draftId)); res.json({ success: true }); } catch (error) { next(error); }
}
