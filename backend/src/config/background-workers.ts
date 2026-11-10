/** Production background jobs require an explicit opt-in after their queues are reviewed. */
export function shouldStartBackgroundWorkers(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BACKGROUND_WORKERS_ENABLED === 'true') return true;
  if (env.BACKGROUND_WORKERS_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}

export type WorkflowWorkerPolicy = { mode: 'disabled' | 'all' } | { mode: 'scoped'; workflowId: string };

/** An explicit Workflow setting never starts unrelated background jobs. */
export function workflowWorkerPolicy(env: NodeJS.ProcessEnv = process.env): WorkflowWorkerPolicy {
  if (env.WORKFLOW_WORKER_ENABLED === 'true') return { mode: 'all' };
  if (env.WORKFLOW_WORKER_ENABLED === 'false') return { mode: 'disabled' };
  if (shouldStartBackgroundWorkers(env)) return { mode: 'all' };
  const workflowId = env.DEAL_STAGE_WORKFLOW_ID?.trim();
  return workflowId ? { mode: 'scoped', workflowId } : { mode: 'disabled' };
}

export function shouldStartCampaignDeliveryReconciliation(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED;
  return setting ? setting === 'true' : shouldStartBackgroundWorkers(env);
}

export function shouldStartCampaignSubmissionWorkers(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.CAMPAIGN_SUBMISSION_WORKERS_ENABLED;
  return setting ? setting === 'true' : shouldStartBackgroundWorkers(env);
}
