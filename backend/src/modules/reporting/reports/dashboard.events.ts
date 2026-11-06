import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../../api/middleware/auth.middleware';
import { workspaceReadyMiddleware } from '../../../api/middleware/tenant.middleware';
import { tenantContext } from '../../../core/tenant/tenant-context';
import prisma from '../../../config/database.config';
import { dashboardAccess } from './dashboard.service';
import { AppError } from '../../../shared/errors/app-error';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { createHash } from 'node:crypto';
import { subscribeRecordChanges } from '../../crm/record-change-events';

/** Same persisted-revision SSE mechanism as Inbox, through the same proxy.
 * Counters become visible only after commit and survive process/replica restarts.
 * Every connection revalidates the real session and current RBAC, including admins.
 */
export const dashboardEvents = (req: Request, res: Response, next: NextFunction) => observeEvents(req, res, next, 'dashboard');
export const authorizationEvents = (req: Request, res: Response, next: NextFunction) => observeEvents(req, res, next, 'authorization');
export const pipelineEvents = (req: Request, res: Response, next: NextFunction) => observeEvents(req, res, next, 'pipeline');
export const recordEvents = (req: Request, res: Response, next: NextFunction) => observeEvents(req, res, next, 'crm');
async function assertRecordAccess(req: Request) {
  for (const permission of ['leads.view', 'contacts.view', 'accounts.view', 'deals.view', 'tasks.view'] as const) {
    try { await assertPermissions(req.user!, [permission]); return; }
    catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
  }
  throw new AppError('Access denied', 403);
}
async function observeEvents(req: Request, res: Response, next: NextFunction, prefix: 'dashboard' | 'authorization' | 'pipeline' | 'crm') {
  const reporting = prefix === 'dashboard';
  const ready = prefix !== 'authorization';
  try {
    if (reporting) await dashboardAccess(req.user!);
    if (prefix === 'pipeline') await assertPermissions(req.user!, ['deals.view']);
    if (prefix === 'crm') await assertRecordAccess(req);
    if (res.destroyed || res.writableEnded) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let busy = false, stopped = false, previous = '', queued = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const closed = () => stopped || res.destroyed || res.writableEnded;
    const cleanup = () => {
      stopped = true; queued = false;
      unsubscribe?.(); unsubscribe = undefined;
      clearInterval(timer); clearTimeout(expiry);
    };
    const end = () => { if (!closed()) { cleanup(); res.end(); } };
    const tenantId = req.user!.tenantId;
    const send = (event: string, data: unknown) => { if (!closed()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const tick = async () => {
      if (closed()) return;
      if (busy) { queued = true; return; }
      busy = true;
      try {
        await new Promise<void>((resolve, reject) => {
          void authMiddleware(req, res, error => error ? reject(error) : resolve());
        });
        if (closed()) return;
        if (ready) await new Promise<void>((resolve, reject) => {
          void workspaceReadyMiddleware(req, res, error => error ? reject(error) : resolve());
        });
        if (closed()) return;
        if (req.user!.tenantId !== tenantId) throw new AppError('Workspace changed', 403);
        const revision = await tenantContext.run({ tenantId }, async () => {
          if (reporting) await dashboardAccess(req.user!);
          if (prefix === 'pipeline') await assertPermissions(req.user!, ['deals.view']);
          if (prefix === 'crm') await assertRecordAccess(req);
          if (closed()) return null;
          return prisma.dashboardRevision.findUnique({ where: { tenantId } });
        });
        if (closed()) return;
        const counters = { analytics: String(revision?.analytics ?? 0), leads: String(revision?.leads ?? 0),
          actions: String(revision?.actions ?? 0), access: String(revision?.access ?? 0) };
        let payload: unknown = reporting ? { ...counters, content: String(revision?.content ?? 0) } : { access: counters.access };
        if (prefix === 'crm') payload = { content: String(revision?.content ?? 0) };
        if (prefix === 'pipeline') {
          // Hash metadata only. Deal/task writes do not cause selector refetches.
          const stages = await tenantContext.run({ tenantId }, () => prisma.stage.findMany({ where: { tenantId, pipeline: { isArchived: false } }, orderBy: { id: 'asc' },
            select: { id: true, pipelineId: true, name: true, color: true, order: true, probability: true, isDefault: true, isWon: true, isLost: true, requiredFields: true, rottenAfterDays: true } }));
          if (closed()) return;
          payload = { metadata: createHash('sha256').update(JSON.stringify(stages)).digest('hex') };
        }
        const key = JSON.stringify(payload);
        if (key !== previous) { send(`${prefix}-change`, payload); previous = key; }
        send(`${prefix}-heartbeat`, {});
      } catch (error) {
        if (closed()) return;
        if (error instanceof AppError && [401,403].includes(error.statusCode)) {
          send(`${prefix}-access-changed`, ['PASSWORD_CHANGE_REQUIRED', 'SESSION_IDLE_EXPIRED'].includes(error.code ?? '') ? { code: error.code } : {}); end();
        } else send(`${prefix}-unavailable`, {});
      } finally { busy = false; if (queued && !closed()) { queued = false; void tick(); } }
    };
    timer = setInterval(() => void tick(), 3000);
    unsubscribe = prefix === 'crm' ? subscribeRecordChanges(tenantId, () => { void tick(); }) : undefined;
    expiry = setTimeout(end, 45000);
    timer.unref(); expiry.unref();
    res.once('close', cleanup); res.once('finish', cleanup); res.once('error', cleanup);
    void tick();
  } catch (error) { next(error); }
}
