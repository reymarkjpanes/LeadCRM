import { expect, it } from 'vitest';
import { shouldStartBackgroundWorkers, shouldStartCampaignDeliveryReconciliation, shouldStartCampaignSubmissionWorkers } from './background-workers';

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
