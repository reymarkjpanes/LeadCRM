import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SendMailboxEmailSchema } from '@leadcrm/shared';
import { fetchEmails, fetchUnreadCount, sendEmail, getConnectionStatus, disconnectAccount, trashEmails, archiveEmails, saveDraft, deleteDraft } from './gmail.service';
import { beginMailboxConnection, finishMailboxConnection } from './mailbox-auth.service';
import { syncMailbox, readMailboxThread, decorateEmails, mailboxPermissions, associateMailboxDeal } from './mailbox-sync.service';
import { AppError } from '../../shared/errors/app-error';
import { writeAuditLog } from '../../core/audit/audit.service';

const providerId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
const messageIdsSchema = z.object({ messageIds: z.array(providerId).min(1).max(100) });
const listSchema = z.object({ maxResults: z.coerce.number().int().min(1).max(50).optional(), query: z.string().max(1000).optional(), pageToken: z.string().max(2000).optional() });

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
    const result = await fetchEmails(tenantId, userId, listSchema.parse(req.query));
    res.json({ ...result, emails: await decorateEmails(tenantId, userId, result.emails, await mailboxPermissions(tenantId, userId)) });
  } catch (error) { next(error); }
}
export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try { res.json(await fetchUnreadCount(req.user!.tenantId, req.user!.userId)); } catch (error) { next(error); }
}
export async function sync(req: Request, res: Response, next: NextFunction) {
  try { res.json(await syncMailbox(req.user!.tenantId, req.user!.userId)); } catch (error) { next(error); }
}
export async function thread(req: Request, res: Response, next: NextFunction) {
  try { res.json(await readMailboxThread(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId))); } catch (error) { next(error); }
}
export async function associateDeal(req: Request, res: Response, next: NextFunction) {
  try { const { dealId } = z.object({ dealId: z.string().min(1).max(200) }).strict().parse(req.body); res.json(await associateMailboxDeal(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.threadId), dealId)); } catch (error) { next(error); }
}
export async function send(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, tenantId } = req.user!;
    const data = SendMailboxEmailSchema.parse(req.body);
    const result = await sendEmail(tenantId, userId, data.to, data.subject, data.body, data.replyToMessageId);
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
export async function trash(req: Request, res: Response, next: NextFunction) {
  try { res.json(await trashEmails(req.user!.tenantId, req.user!.userId, messageIdsSchema.parse(req.body).messageIds)); } catch (error) { next(error); }
}
export async function archive(req: Request, res: Response, next: NextFunction) {
  try { res.json(await archiveEmails(req.user!.tenantId, req.user!.userId, messageIdsSchema.parse(req.body).messageIds)); } catch (error) { next(error); }
}
export async function saveDraftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = z.object({ to: z.string().max(998).refine(value => !/[\r\n]/.test(value)), subject: z.string().max(998).refine(value => !/[\r\n]/.test(value)), body: z.string().max(200000), draftId: providerId.optional() }).parse(req.body);
    res.json({ success: true, ...await saveDraft(req.user!.tenantId, req.user!.userId, data.to, data.subject, data.body, data.draftId) });
  } catch (error) { next(error); }
}
export async function deleteDraftHandler(req: Request, res: Response, next: NextFunction) {
  try { await deleteDraft(req.user!.tenantId, req.user!.userId, providerId.parse(req.params.draftId)); res.json({ success: true }); } catch (error) { next(error); }
}
