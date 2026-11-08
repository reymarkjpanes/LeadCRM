/** Production background jobs require an explicit opt-in after their queues are reviewed. */
export function shouldStartBackgroundWorkers(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BACKGROUND_WORKERS_ENABLED === 'true') return true;
  if (env.BACKGROUND_WORKERS_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}
