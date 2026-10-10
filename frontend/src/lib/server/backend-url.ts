/** Server-only configuration, shared by Next's config and API route handlers. */
export function getBackendUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.API_URL?.trim();
  const message = 'API_URL must be an explicit backend URL ending in /api/v1 (HTTPS in production).';
  if (!value) throw new Error(message);

  let url: URL;
  try { url = new URL(value); } catch { throw new Error(message); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api/v1' ||
      (env.NODE_ENV === 'production' && (url.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error(message);
  }
  return value.replace(/\/+$/, '');
}
