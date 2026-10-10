import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { ForgotPasswordSchema } from '@leadcrm/shared';
import { validate } from '../validate.middleware';
let server: Server, base: string;
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const { passwordResetRateLimiter, passwordRecoveryAddressRateLimiter } = await import('../rate-limit.middleware');
  const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
  app.post('/recovery', passwordResetRateLimiter, validate(ForgotPasswordSchema), passwordRecoveryAddressRateLimiter, (_req, res) => res.json({ success: true }));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); vi.unstubAllEnvs(); });
async function request(email: string, ip: string) {
  return fetch(base + '/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email }) });
}
describe('production recovery abuse limits', () => {
  it('limits an IP to three attempts an hour across different addresses', async () => {
    for (let i = 0; i < 3; i++) expect((await request(`ip-${i}@example.com`, '192.0.2.1')).status).toBe(200);
    const blocked = await request('ip-next@example.com', '192.0.2.1');
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('limits the same normalized address across different IPs', async () => {
    for (let i = 0; i < 3; i++) expect((await request(' NORMALIZED@example.com ', `192.0.2.${10 + i}`)).status).toBe(200);
    const blocked = await request('normalized@EXAMPLE.COM', '192.0.2.20');
    expect(blocked.status).toBe(429); expect((await blocked.json()).error.code).toBe('PASSWORD_RECOVERY_RATE_LIMITED');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
