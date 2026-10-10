import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

// In development, use very high limits to avoid blocking local testing
const isDev = process.env.NODE_ENV !== 'production';

// General API rate limit — 100 requests per minute per IP
export const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : Number(process.env.RATE_LIMIT_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests — please try again later.' },
});

// Strict limit for credential-guessing surfaces
// In dev: effectively unlimited so local testing is never blocked
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts — try again in 15 minutes.' },
});

// Extra-strict limit for password reset
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many password reset requests — try again in an hour.' },
});

// Runs after validation/normalization. Keys never contain an address or tenant ID.
export const passwordRecoveryAddressRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 3,
  keyGenerator: req => createHash('sha256').update(req.body.email).digest('hex'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    console.warn('[PasswordRecovery]', { event: 'address_rate_limited' });
    res.status(429).json({ success: false, error: { code: 'PASSWORD_RECOVERY_RATE_LIMITED', message: 'Too many password reset requests — try again in an hour.' } });
  },
});
