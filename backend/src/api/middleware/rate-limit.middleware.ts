import rateLimit from 'express-rate-limit';

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

export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many registration attempts — try again in an hour.' },
});

// Extra-strict limit for password reset
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many password reset requests — try again in an hour.' },
});

// Rate limit for magic link verification — prevents token brute-force
export const verifyEmailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many verification attempts — try again later.' },
});

// Rate limit for resend verification — keyed by email, NOT by IP.
// Keying by IP was broken on Render: all users shared one bucket because
// Render's LB IP was seen as the client IP due to proxy hop misconfiguration.
// Keying by email means each user gets their own independent 3/minute window.
export const resendVerificationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 10000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by email so each address gets its own bucket regardless of shared proxy IPs.
  // Falls back to IP if email is missing (malformed requests).
  keyGenerator: (req) => {
    const email = (req.body as Record<string, unknown>)?.email;
    return typeof email === 'string' && email.includes('@')
      ? `resend:${email.toLowerCase().trim()}`
      : req.ip ?? 'unknown';
  },
  message: { success: false, error: 'Please wait before requesting another verification email.' },
});

// Billing mutation rate limit — 10 requests per minute per IP
// Prevents rapid-fire upgrade/downgrade/seat operations
export const billingMutationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many billing requests — please wait a moment and try again.' },
});
