/** Public destinations only; never derive account links from a request header. */
export function getAuthAppOrigin(): string {
  const value = process.env.APP_URL?.trim() || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('APP_URL must be the public frontend origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('APP_URL must be the public frontend origin (HTTPS in production).');
  }
  return url.origin;
}

/** Shared by the token lifetime and its email notice. Invalid configuration fails closed. */
export function getPasswordResetTtlMinutes(): number {
  const value = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? '60');
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PASSWORD_RESET_TTL_MINUTES must be a positive whole number.');
  }
  return value;
}

export const AUTH_SUPPORT_EMAIL = 'leadcrm.tech@gmail.com';
