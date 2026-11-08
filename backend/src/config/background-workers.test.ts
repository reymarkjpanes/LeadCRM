import { expect, it } from 'vitest';
import { shouldStartBackgroundWorkers } from './background-workers';

it('keeps production background workers off unless explicitly enabled', () => {
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production' })).toBe(false);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'false' })).toBe(false);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'production', BACKGROUND_WORKERS_ENABLED: 'true' })).toBe(true);
});

it('preserves local worker behavior unless explicitly disabled', () => {
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'development' })).toBe(true);
  expect(shouldStartBackgroundWorkers({ NODE_ENV: 'development', BACKGROUND_WORKERS_ENABLED: 'false' })).toBe(false);
});
