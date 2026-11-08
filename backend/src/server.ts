import { startCustomerClassificationScheduler } from './modules/crm/customer-classification.scheduler';
import { startSmsReplyScheduler } from './integrations/sms/sms-replies';
import 'dotenv/config';
import app from './app';
import { startNotificationScheduler } from './modules/notifications/notification-events.service';
import { startMailboxScheduler } from './integrations/gmail/mailbox-sync.service';
import { startCampaignRecoveryScheduler } from './modules/marketing/campaigns/campaign-submission-recovery';
import { drainCampaignSubmissions, resumeCampaignSubmissions, startCampaignScheduleScheduler } from './modules/marketing/campaigns/campaigns.service';
import { purgeExpiredSessions } from './core/auth/session.service';
import { startImportCleanupScheduler } from './modules/crm/imports/import-cleanup.service';
import { validateEnvironment } from './config/validate-env';
import { shouldStartBackgroundWorkers } from './config/background-workers';
import { startWorkflowScheduler } from './modules/automation/workflows/workflow-queue';
import { startSmsStatusReconciliation } from './modules/marketing/campaigns/sms-status-reconciliation';
import prisma from './config/database.config';
import { installCrmRetirementMaintenance } from './core/maintenance/crm-retirement-maintenance';

validateEnvironment();

const PORT = process.env.PORT ?? 4000;
const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * Schedule periodic session table cleanup.
 * Expired sessions accumulate over time — purge them once per day to keep
 * the Session table lean. Uses a simple setInterval; no external cron needed.
 *
 * Runs immediately on startup (catches anything left from a cold deploy),
 * then every 24 hours thereafter.
 */
function startSessionPurgeScheduler(): () => Promise<void> {
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  let pending: Promise<void> | undefined;
  const runPurge = () => {
    if (pending) return;
    pending = purgeExpiredSessions()
      .then((count) => {
        if (count > 0) {
          console.log(`[session-purge] Removed ${count} expired session record(s).`);
        }
      })
      .catch((err: unknown) => {
        console.error('[session-purge] Error during session cleanup:', err instanceof Error ? err.message : err);
        // Non-fatal — the server continues running
      }).finally(() => { pending = undefined; });
  };

  // Immediate run on startup
  runPurge();

  // Recurring daily cleanup
  const timer = setInterval(runPurge, PURGE_INTERVAL_MS);

  console.log('[session-purge] Session cleanup scheduler started (runs every 24h).');
  return async () => { clearInterval(timer); await pending; };
}

let stopMailbox: (() => Promise<void>) | undefined;
let stopNotifications: (() => Promise<void>) | undefined;
let stopCampaignSchedule: (() => Promise<void>) | undefined;
let stopCampaignRecovery: (() => Promise<void>) | undefined;
let stopSmsReconciliation: (() => Promise<void>) | undefined;
let stopCustomerClassification: (() => Promise<void>) | undefined;
let stopSmsReplies: (() => Promise<void>) | undefined;
let stopWorkflows: (() => Promise<void>) | undefined;
let stopSessions: (() => Promise<void>) | undefined;
let stopImports: (() => Promise<void>) | undefined;
let backgroundStarted = false;
let backgroundDrain: Promise<void> | undefined;
function startBackground() {
  if (backgroundStarted) return;
  if (!shouldStartBackgroundWorkers()) {
    console.info('[workers] Background workers are disabled by production policy.');
    return;
  }
  resumeCampaignSubmissions();
  backgroundStarted = true;
  stopCampaignRecovery = startCampaignRecoveryScheduler();
  stopSmsReconciliation = startSmsStatusReconciliation();
  stopWorkflows = startWorkflowScheduler();
  stopSmsReplies = startSmsReplyScheduler();
  stopCustomerClassification = startCustomerClassificationScheduler();
  stopCampaignSchedule = startCampaignScheduleScheduler();
  stopMailbox = startMailboxScheduler();
  if (process.env.NOTIFICATION_WORKER_ENABLED !== 'false') stopNotifications = startNotificationScheduler();
  stopSessions = startSessionPurgeScheduler();
  stopImports = startImportCleanupScheduler();
}
async function stopBackground() {
  if (backgroundDrain) return backgroundDrain;
  if (!backgroundStarted) return;
  backgroundStarted = false;
  backgroundDrain = Promise.all([
    stopMailbox?.(), stopNotifications?.(), stopCampaignRecovery?.(), stopSmsReconciliation?.(),
    stopCampaignSchedule?.(), stopWorkflows?.(), stopSmsReplies?.(), stopCustomerClassification?.(),
    stopSessions?.(), stopImports?.(), drainCampaignSubmissions(),
  ]).then(() => undefined);
  try { await backgroundDrain; } finally { backgroundDrain = undefined; }
}
const maintenance = installCrmRetirementMaintenance({
  start: startBackground,
  stop: stopBackground,
  runtimeReadOnly: async () => {
    const [row] = await prisma.$queryRawUnsafe<Array<{ readonly: string }>>("SELECT current_setting('transaction_read_only') AS readonly");
    return row.readonly === 'on';
  },
});
const server = app.listen(Number(PORT), HOST, () => {
  console.log(`[server] LeadCRM API running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
  void maintenance.start();
});
server.on('close', () => { void maintenance.stop(); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  const drain = maintenance.stop();
  server.close(() => { void drain.finally(() => process.exit(0)); });
  // Interrupted mailbox pages and scheduled claims resume from durable leases.
  setTimeout(() => process.exit(0), 30000).unref();
});
