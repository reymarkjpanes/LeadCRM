import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { errorMiddleware } from './api/middleware/error.middleware';
import { loggerMiddleware } from './api/middleware/logger.middleware';
import { rateLimitMiddleware } from './api/middleware/rate-limit.middleware';
import router from './api/routes/index';

const app = express();

// ── Trust Render/proxy headers ────────────────────────
// Render routes traffic through multiple proxy hops (Render LB + internal routing).
// Setting trust proxy: 1 caused Express to read Render's LB IP as the client IP,
// making ALL users share the same rate-limit bucket — every user on the platform
// was rate-limited together instead of individually.
// Setting to true makes Express correctly read the real client IP from X-Forwarded-For.
app.set('trust proxy', true);

// ── Security Headers (must be first) ─────────────────
app.use(helmet());
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));

// ── CORS — restrict to known frontend origins ─────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.APP_URL ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, health checks)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);

// ── Response Compression (gzip/brotli) ─────────────────
app.use(compression());

// ── Body Parsing ─────────────────────────────────────
// Stripe webhooks require a raw body Buffer for signature verification.
// Skip express.json() on the webhook path — that route registers raw() itself.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/v1/webhooks/stripe') {
    next(); // raw() applied at route level in admin.routes.ts
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ── Request Logging & Rate Limiting ──────────────────
app.use(loggerMiddleware);
app.use(rateLimitMiddleware);

// ── Routes ────────────────────────────────────────────
app.use('/api/v1', router);

// ── Health Check ──────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error Handler (must be last) ──────────────────────
app.use(errorMiddleware);

export default app;
