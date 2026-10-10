import { z } from 'zod';

/** Report variable names only; configuration errors must never echo secrets. */
export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`);
  }
  if (env.GMAIL_SYNC_INTERVAL_SECONDS && !z.coerce.number().int().min(60).max(3600).safeParse(env.GMAIL_SYNC_INTERVAL_SECONDS).success) throw new Error('GMAIL_SYNC_INTERVAL_SECONDS must be an integer from 60 to 3600.');
  if (env.NODE_ENV !== 'production') return;

  if (!env.BREVO_API_KEY?.startsWith('xkeysib-') || env.BREVO_API_KEY.trim().length <= 20) {
    throw new Error('BREVO_API_KEY is missing or invalid. Configure the production email provider.');
  }
  if (!z.string().email().safeParse(env.BREVO_FROM_EMAIL).success) {
    throw new Error('BREVO_FROM_EMAIL must be a verified sender email address.');
  }
  const isHttpsOrigin = (value: string | undefined): boolean => {
    try {
      const url = new URL(value ?? '');
      return url.protocol === 'https:' && !url.username && !url.password &&
        !url.search && !url.hash && url.pathname === '/' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { return false; }
  };
  if (!isHttpsOrigin(env.APP_URL)) throw new Error('APP_URL must be the public HTTPS frontend origin.');
  const origins = env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()) ?? [];
  if (!origins.length || !origins.every(isHttpsOrigin)) {
    throw new Error('ALLOWED_ORIGINS must list explicit HTTPS frontend origins.');
  }
  if (env.GMAIL_CLIENT_ID) {
    for (const [key, path] of [['GMAIL_REDIRECT_URI', '/api/v1/integrations/gmail/callback']]) {
      let valid = false;
      try { const url = new URL(env[key] ?? ''); valid = isHttpsOrigin(url.origin) && url.pathname === path && !url.search && !url.hash && !url.username && !url.password; } catch { /* Report variable names only. */ }
      if (!valid) throw new Error(`${key} must use the public HTTPS backend endpoint.`);
    }
  }
}
