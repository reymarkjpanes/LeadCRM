import { expect, it } from 'vitest';
import { shouldStartBackgroundWorkers, shouldStartCampaignDeliveryReconciliation, shouldStartCampaignSubmissionWorkers, workflowWorkerPolicy } from './background-workers';

it('keeps production background workers off unless explicitly enabled', () => {
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production' })).toBe(false);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'false' })).toBe(false);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'true' })).toBe(true);
});

it('allows campaign submissions independently and otherwise inherits the general worker policy', () => {
  const production = { NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'false', CAMPAIGN_SUBMISSION_WORKERS_ENABLED: 'true' };
  expect(shouldStartCampaignSubmissionWorkers(production)).toBe(true);
  expect(shouldStartBackgroundWorkers(production)).toBe(false);
  expect(shouldStartCampaignDeliveryReconciliation(production)).toBe(false);
  expect(shouldStartCampaignSubmissionWorkers({ NODE_ENV: 'production' })).toBe(false);
  expect(shouldStartCampaignSubmissionWorkers({ NODE_ENV: 'development' })).toBe(true);
  expect(shouldStartCampaignSubmissionWorkers({ NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'true' })).toBe(true);
  expect(shouldStartCampaignSubmissionWorkers({ BACKGROUND_WORKERS_ENABLED: 'true', CAMPAIGN_SUBMISSION_WORKERS_ENABLED: 'false' })).toBe(false);
});

it('preserves local worker behavior unless explicitly disabled', () => {
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'development' })).toBe(true);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'development', BACKGROUND_WORKERS_ENABLED: 'false' })).toBe(false);
});

it('allows receipt reconciliation independently of submission and other workers', () => {
  const production = { NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'false', CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED: 'true' };
  expect(shouldStartCampaignDeliveryReconciliation(production)).toBe(true);
  expect(shouldStartBackgroundWorkers(production)).toBe(false);
  expect(shouldStartCampaignDeliveryReconciliation({ NODE_ENV: 'production' })).toBe(false);
  expect(shouldStartCampaignDeliveryReconciliation({ NODE_ENV: 'development' })).toBe(true);
  expect(shouldStartCampaignDeliveryReconciliation({ NODE_ENV: 'development', CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED: 'false' })).toBe(false);
});

it.each([
  [{ NODE_ENV: 'production' }, { mode: 'disabled' }],
  [{ NODE_ENV: 'development' }, { mode: 'all' }],
  [{ NODE_ENV: 'production', DEAL_STAGE_WORKFLOW_ID: ' workflow ' }, { mode: 'scoped', workflowId: 'workflow' }],
  [{ BACKGROUND_WORKERS_ENABLED: 'true', DEAL_STAGE_WORKFLOW_ID: 'workflow' }, { mode: 'all' }],
  [{ BACKGROUND_WORKERS_ENABLED: 'false', DEAL_STAGE_WORKFLOW_ID: 'workflow' }, { mode: 'scoped', workflowId: 'workflow' }],
  [{ BACKGROUND_WORKERS_ENABLED: 'false', DEAL_STAGE_WORKFLOW_ID: 'workflow', WORKFLOW_WORKER_ENABLED: 'true' }, { mode: 'all' }],
  [{ BACKGROUND_WORKERS_ENABLED: 'true', WORKFLOW_WORKER_ENABLED: 'false' }, { mode: 'disabled' }],
  [{ BACKGROUND_WORKERS_ENABLED: 'false', DEAL_STAGE_WORKFLOW_ID: 'workflow', WORKFLOW_WORKER_ENABLED: 'false' }, { mode: 'disabled' }],
])('resolves the independent Workflow policy for %j', (env, expected) => {
  expect(workflowWorkerPolicy(env)).toEqual(expected);
});

it('does not enable general, campaign, or reconciliation workers with the Workflow opt-in', () => {
  const env = { NODE_ENV: 'production', WORKFLOW_WORKER_ENABLED: 'true' };
  expect(workflowWorkerPolicy(env)).toEqual({ mode: 'all' });
  expect(shouldStartBackgroundWorkers(env)).toBe(false);
  expect(shouldStartCampaignSubmissionWorkers(env)).toBe(false);
  expect(shouldStartCampaignDeliveryReconciliation(env)).toBe(false);
});
