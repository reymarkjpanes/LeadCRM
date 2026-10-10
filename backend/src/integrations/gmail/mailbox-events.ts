import { Request, Response, NextFunction } from 'express';
import { authorizedMailbox } from './mailbox-store';
import { tenantContext } from '../../core/tenant/tenant-context';

// One persisted-state observer per account per process, shared by all its tabs.
// Database revisions also deliver updates across backend replicas.
const observers = new Map<string, { clients: Set<Response>; stop: () => void }>();
export async function mailboxEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, userId } = req.user!;
    const { account } = await authorizedMailbox(tenantId, userId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let observer = observers.get(account.id);
    if (!observer) {
      const clients = new Set<Response>();
      let busy = false, revision = '';
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const current = await tenantContext.run({ tenantId }, () => authorizedMailbox(tenantId, userId));
          const updated = `${current.account.mailboxVersion}:${current.scope.hash}`;
          if (updated !== revision) {
            revision = updated;
            for (const client of clients) client.write(`event: mailbox-change\ndata: ${JSON.stringify({ version: current.account.mailboxVersion })}\n\n`);
          } else for (const client of clients) client.write(': heartbeat\n\n');
        } catch {
          for (const client of clients) { client.write('event: mailbox-access-changed\ndata: {}\n\n'); client.end(); }
        } finally { busy = false; }
      };
      const timer = setInterval(() => void tick(), 5000);
      timer.unref();
      observer = { clients, stop: () => clearInterval(timer) };
      observers.set(account.id, observer);
    }
    observer.clients.add(res);
    // Bound connection lifetime and reauthenticate the actual session on reconnect.
    const expiry = setTimeout(() => res.end(), 45000);
    const cleanup = () => {
      clearTimeout(expiry);
      observer!.clients.delete(res);
      if (!observer!.clients.size) { observer!.stop(); observers.delete(account.id); }
    };
    res.on('close', cleanup);
  } catch (error) { next(error); }
}
