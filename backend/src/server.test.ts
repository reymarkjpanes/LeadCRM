import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({
  schedule: vi.fn(), recovery: vi.fn(), delivery: vi.fn(), workflow: vi.fn(), mailbox: vi.fn(),
  notifications: vi.fn(), replies: vi.fn(), classification: vi.fn(), imports: vi.fn(), purge: vi.fn(),
  resume: vi.fn(), drain: vi.fn(), stop: vi.fn(),
  ready: undefined as undefined | (() => void),
  lifecycle: undefined as undefined | { start: () => void; stop: () => Promise<void> },
}));
vi.mock('dotenv/config', () => ({}));
vi.mock('./app', () => ({ default: { listen: (_port: number, _host: string, ready: () => void) => {
  workers.ready = ready;
  return { on: vi.fn(), close: vi.fn() };
} } }));
vi.mock('./config/validate-env', () => ({ validateEnvironment: vi.fn() }));
vi.mock('./config/database.config', () => ({ default: {} }));
vi.mock('./core/maintenance/crm-retirement-maintenance', () => ({ installCrmRetirementMaintenance: (lifecycle: typeof workers.lifecycle) => {
  workers.lifecycle = lifecycle;
  return { start: async () => lifecycle!.start(), stop: () => lifecycle!.stop() };
} }));
vi.mock('./modules/marketing/campaigns/campaigns.service', () => ({ startCampaignScheduleScheduler: workers.schedule, resumeCampaignSubmissions: workers.resume, drainCampaignSubmissions: workers.drain }));
vi.mock('./modules/marketing/campaigns/campaign-submission-recovery', () => ({ startCampaignRecoveryScheduler: workers.recovery }));
vi.mock('./modules/marketing/campaigns/sms-status-reconciliation', () => ({ startCampaignDeliveryReconciliation: workers.delivery }));
vi.mock('./modules/automation/workflows/workflow-queue', () => ({ startWorkflowScheduler: workers.workflow }));
vi.mock('./integrations/gmail/mailbox-sync.service', () => ({ startMailboxScheduler: workers.mailbox }));
vi.mock('./modules/notifications/notification-events.service', () => ({ startNotificationScheduler: workers.notifications }));
vi.mock('./integrations/sms/sms-replies', () => ({ startSmsReplyScheduler: workers.replies }));
vi.mock('./modules/crm/customer-classification.scheduler', () => ({ startCustomerClassificationScheduler: workers.classification }));
vi.mock('./modules/crm/imports/import-cleanup.service', () => ({ startImportCleanupScheduler: workers.imports }));
vi.mock('./core/auth/session.service', () => ({ purgeExpiredSessions: workers.purge }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BACKGROUND_WORKERS_ENABLED', 'false');
  vi.stubEnv('WORKFLOW_WORKER_ENABLED', undefined);
  vi.stubEnv('CAMPAIGN_SUBMISSION_WORKERS_ENABLED', 'true');
  vi.stubEnv('CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED', 'false'); vi.stubEnv('DEAL_STAGE_WORKFLOW_ID', '');
  for (const start of [workers.schedule, workers.recovery, workers.delivery, workers.workflow, workers.mailbox, workers.notifications, workers.replies, workers.classification, workers.imports]) start.mockReturnValue(workers.stop);
  workers.stop.mockResolvedValue(undefined); workers.drain.mockResolvedValue(undefined); workers.purge.mockResolvedValue(0);
  vi.spyOn(process, 'once').mockReturnValue(process);
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { await workers.lifecycle?.stop(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function boot() { await import('./server'); workers.ready!(); }

it('starts campaign timers from the production entrypoint without enabling unrelated workers', async () => {
  await boot(); workers.lifecycle!.start();
  expect(workers.schedule).toHaveBeenCalledOnce(); expect(workers.recovery).toHaveBeenCalledOnce();
  for (const start of [workers.delivery, workers.workflow, workers.mailbox, workers.notifications, workers.replies, workers.classification, workers.imports, workers.purge]) expect(start).not.toHaveBeenCalled();
  expect(workers.resume).toHaveBeenCalledOnce();
  await workers.lifecycle!.stop(); await workers.lifecycle!.stop();
  expect(workers.stop).toHaveBeenCalledTimes(2); expect(workers.drain).toHaveBeenCalledOnce();
  workers.lifecycle!.start();
  expect(workers.resume).toHaveBeenCalledTimes(2); expect(workers.schedule).toHaveBeenCalledTimes(2); expect(workers.recovery).toHaveBeenCalledTimes(2);
});

it('waits for a shared shutdown drain before maintenance resumes campaign work', async () => {
  await boot();
  let finish!: () => void;
  workers.drain.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const first = workers.lifecycle!.stop(), second = workers.lifecycle!.stop();
  expect(workers.drain).toHaveBeenCalledOnce(); expect(workers.stop).toHaveBeenCalledTimes(2);
  finish(); await Promise.all([first, second]);
  workers.lifecycle!.start();
  expect(workers.resume).toHaveBeenCalledTimes(2); expect(workers.schedule).toHaveBeenCalledTimes(2);
});

it('still drains and resumes Send Now when all timers are disabled', async () => {
  vi.stubEnv('CAMPAIGN_SUBMISSION_WORKERS_ENABLED', 'false');
  await boot();
  expect(workers.schedule).not.toHaveBeenCalled(); expect(workers.recovery).not.toHaveBeenCalled();
  await workers.lifecycle!.stop();
  expect(workers.drain).toHaveBeenCalledOnce();
  workers.lifecycle!.start(); expect(workers.resume).toHaveBeenCalledTimes(2);
});

it('honors the explicit submission opt-out while keeping other enabled workers', async () => {
  vi.useFakeTimers(); vi.stubEnv('BACKGROUND_WORKERS_ENABLED', 'true'); vi.stubEnv('CAMPAIGN_SUBMISSION_WORKERS_ENABLED', 'false');
  await boot();
  expect(workers.schedule).not.toHaveBeenCalled(); expect(workers.recovery).not.toHaveBeenCalled();
  expect(workers.workflow).toHaveBeenCalledOnce(); expect(workers.mailbox).toHaveBeenCalledOnce();
});

it('starts all Workflows once through the independent override without starting unrelated jobs', async () => {
  vi.stubEnv('WORKFLOW_WORKER_ENABLED', 'true'); vi.stubEnv('DEAL_STAGE_WORKFLOW_ID', 'selected-workflow');
  vi.stubEnv('CAMPAIGN_SUBMISSION_WORKERS_ENABLED', 'false');
  await boot(); workers.lifecycle!.start();
  expect(workers.workflow).toHaveBeenCalledOnce();
  expect(workers.workflow.mock.calls[0][0]).toBeUndefined();
  for (const start of [workers.schedule, workers.recovery, workers.delivery, workers.mailbox, workers.notifications, workers.replies, workers.classification, workers.imports, workers.purge]) expect(start).not.toHaveBeenCalled();
  await workers.lifecycle!.stop();
  expect(workers.stop).toHaveBeenCalledOnce();
  workers.lifecycle!.start(); expect(workers.workflow).toHaveBeenCalledTimes(2);
});

it('explicitly disables Workflows while preserving other general workers', async () => {
  vi.useFakeTimers(); vi.stubEnv('BACKGROUND_WORKERS_ENABLED', 'true'); vi.stubEnv('WORKFLOW_WORKER_ENABLED', 'false');
  vi.stubEnv('DEAL_STAGE_WORKFLOW_ID', 'selected-workflow');
  await boot();
  expect(workers.workflow).not.toHaveBeenCalled();
  expect(workers.mailbox).toHaveBeenCalledOnce(); expect(workers.classification).toHaveBeenCalledOnce();
});

it('preserves scoped processing when the Workflow override is unset', async () => {
  vi.stubEnv('DEAL_STAGE_WORKFLOW_ID', 'selected-workflow');
  await boot();
  expect(workers.workflow).toHaveBeenCalledExactlyOnceWith('selected-workflow');
  expect(workers.mailbox).not.toHaveBeenCalled();
});
