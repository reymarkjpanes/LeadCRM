import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import app from '../../../../app';

let server: Server, base: string;
const previousTrust = app.get('trust proxy');
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BREVO_WEBHOOK_TOKEN', 'proxy-test-token-at-least-32-characters');
  vi.stubEnv('TEXTBEE_WEBHOOK_SECRET', 'proxy-test-signature-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/webhooks`;
});
afterAll(async () => {
  app.set('trust proxy', previousTrust);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});

it.each(['brevo', 'textbee'])('%s rejects spoofed HTTPS from an untrusted peer and authenticates only through trusted ingress', async provider => {
  const post = (proto: string) => fetch(`${base}/${provider}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': proto, 'X-Forwarded-For': '172.18.0.11' }, body: '{}' });
  app.set('trust proxy', false);
  const untrusted = await post('https');
  expect(untrusted.status).toBe(400);
  expect(await untrusted.json()).toMatchObject({ error: 'HTTPS is required.' });
  expect(console.warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({
    event: `${provider}_webhook_failed`, category: 'https', socketPeer: '127.0.0.1',
    secure: false, forwardedProtocol: 'https',
  }));
  app.set('trust proxy', 'loopback');
  expect((await post('https')).status).toBe(401);
  expect((await post('http')).status).toBe(400);
  app.set('trust proxy', false);
  expect((await post('private-untrusted-header')).status).toBe(400);
  expect(console.warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({
    event: `${provider}_webhook_failed`, forwardedProtocol: 'other',
  }));
});
