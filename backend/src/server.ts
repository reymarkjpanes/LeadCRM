import 'dotenv/config';
import app from './app';
import { startNotificationScheduler } from './modules/notifications/notification-events.service';
import { startMailboxScheduler } from './integrations/gmail/mailbox-sync.service';
import { startCampaignRecoveryScheduler } from './modules/marketing/campaigns/campaign-submission-recovery';
import { drainCampaignSubmissions } from './modules/marketing/campaigns/campaigns.service';
import { purgeExpiredSessions } from './core/auth/session.service';
import { startImportCleanupScheduler } from './modules/crm/imports/import-cleanup.service';
import { validateEnvironment } from './config/validate-env';

validateEnvironment();

const PORT = process.env.PORT ?? 4000;

/**
 * Schedule periodic session table cleanup.
 * Expired sessions accumulate over time — purge them once per day to keep
 * the Session table lean. Uses a simple setInterval; no external cron needed.
 *
 * Runs immediately on startup (catches anything left from a cold deploy),
 * then every 24 hours thereafter.
 */
function startSessionPurgeScheduler(): void {
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const runPurge = () => {
    purgeExpiredSessions()
      .then((count) => {
        if (count > 0) {
          console.log(`[session-purge] Removed ${count} expired session record(s).`);
        }
      })
      .catch((err: unknown) => {
        console.error('[session-purge] Error during session cleanup:', err instanceof Error ? err.message : err);
        // Non-fatal — the server continues running
      });
  };

  // Immediate run on startup
  runPurge();

  // Recurring daily cleanup
  setInterval(runPurge, PURGE_INTERVAL_MS);

  console.log('[session-purge] Session cleanup scheduler started (runs every 24h).');
}

let stopMailbox: (() => void) | undefined;
let stopNotifications: (() => Promise<void>) | undefined;
let stopCampaignRecovery: (() => Promise<void>) | undefined;
const server = app.listen(PORT, () => {
  console.log(`[server] LeadCRM API running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);

  // Start background services
  stopCampaignRecovery = startCampaignRecoveryScheduler();
  stopMailbox = startMailboxScheduler();
  if (process.env.NOTIFICATION_WORKER_ENABLED !== 'false') stopNotifications = startNotificationScheduler();
  startSessionPurgeScheduler();
  startImportCleanupScheduler();


});
server.on('close', () => { stopMailbox?.(); void stopNotifications?.(); void stopCampaignRecovery?.(); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  stopMailbox?.();
  const drain = drainCampaignSubmissions();
  server.close(() => { void Promise.allSettled([drain, stopNotifications?.(), stopCampaignRecovery?.()]).finally(() => process.exit(0)); });
  // Interrupted mailbox pages and scheduled claims resume from durable leases.
  setTimeout(() => process.exit(0), 30000).unref();
});
