import 'dotenv/config';
import app from './app';
import { startCampaignScheduler } from './core/scheduler/campaign-scheduler.service';
import { purgeExpiredSessions } from './core/auth/session.service';

// Guard against missing required env vars at startup
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

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

app.listen(PORT, () => {
  console.log(`[server] LeadCRM API running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
  
  // Start background services
  startCampaignScheduler();
  startSessionPurgeScheduler();
});
