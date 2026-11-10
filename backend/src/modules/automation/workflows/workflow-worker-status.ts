import { workflowWorkerPolicy } from '../../../config/background-workers';

let running = false;
let draining = false;
let lastSuccessfulSweepAt: string | null = null;
let lastFailedSweepAt: string | null = null;
let mode: 'all' | 'scoped' | undefined;

/** Process-local observations; no tenant IDs, queue contents, or error messages. */
export function workflowWorkerStatus() {
  return { scope: 'process' as const, mode: mode ?? workflowWorkerPolicy().mode, running,
    state: draining ? 'draining' as const : running ? 'running' as const : 'stopped' as const,
    lastSuccessfulSweepAt, lastFailedSweepAt };
}

export function workflowWorkerStarted(scoped: boolean) {
  mode = scoped ? 'scoped' : 'all'; running = true; draining = false;
  lastSuccessfulSweepAt = null; lastFailedSweepAt = null;
}
export function workflowWorkerDraining() { draining = true; }
export function workflowWorkerStopped() { running = false; draining = false; }
export function workflowWorkerSweep(succeeded: boolean) {
  if (succeeded) lastSuccessfulSweepAt = new Date().toISOString();
  else lastFailedSweepAt = new Date().toISOString();
}
