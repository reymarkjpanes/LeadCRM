import { afterEach, expect, it, vi } from 'vitest';
import { workflowWorkerStarted, workflowWorkerDraining, workflowWorkerStopped, workflowWorkerStatus, workflowWorkerSweep } from '../workflow-worker-status';

afterEach(() => { workflowWorkerStopped(); vi.useRealTimers(); });
it('reports process-local startup, sweeps, failure and shutdown without exposing queue identities', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
  workflowWorkerStarted(true);
  expect(workflowWorkerStatus()).toEqual({ scope: 'process', mode: 'scoped', running: true, state: 'running', lastSuccessfulSweepAt: null, lastFailedSweepAt: null });
  workflowWorkerSweep(true);
  vi.advanceTimersByTime(1000); workflowWorkerSweep(false);
  expect(workflowWorkerStatus()).toMatchObject({ lastSuccessfulSweepAt: '2026-11-11T00:00:00.000Z', lastFailedSweepAt: '2026-11-11T00:00:01.000Z' });
  workflowWorkerDraining(); expect(workflowWorkerStatus()).toMatchObject({ running: true, state: 'draining' });
  workflowWorkerStopped(); expect(workflowWorkerStatus()).toMatchObject({ running: false, state: 'stopped' });
  workflowWorkerStarted(false);
  expect(workflowWorkerStatus()).toEqual({ scope: 'process', mode: 'all', running: true, state: 'running', lastSuccessfulSweepAt: null, lastFailedSweepAt: null });
});
