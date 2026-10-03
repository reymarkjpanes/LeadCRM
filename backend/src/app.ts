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

// Trust only explicitly configured proxy addresses, never arbitrary forwarded IPs.
// Hosting must supply its actual ingress CIDRs; loopback supports the local proxy.
app.set('trust proxy', (process.env.TRUSTED_PROXIES ?? 'loopback').split(',').map(value => value.trim()).filter(Boolean));

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
app.use('/api/v1/public/forms', express.json({ limit: '64kb' }));
app.use(express.json({ limit: '1mb' }));
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
