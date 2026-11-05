import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import app from '../../../app';

describe('proxy trust boundary', () => {
  it('does not trust arbitrary internet addresses or all forwarded headers', () => {
    expect(app.get('trust proxy')).not.toBe(true);
    const trust = app.get('trust proxy fn') as (address: string) => boolean;
    expect(trust('127.0.0.1')).toBe(true);
    expect(trust('::1')).toBe(true);
    expect(trust('198.51.100.25')).toBe(false);
  });
});

describe('production provider callbacks behind scoped ingress', () => {
  let server: Server, base: string;
  const originalTrust = app.get('trust proxy');
  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/webhooks`;
  });
  afterEach(() => { app.set('trust proxy', originalTrust); vi.unstubAllEnvs(); });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const post = (provider: string, headers: Record<string, string> = {}) => fetch(`${base}/${provider}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}',
  });

  it('trusts only the configured ingress address in addition to existing loopback entries', () => {
    app.set('trust proxy', ['loopback', '172.19.0.2/32']);
    const trust = app.get('trust proxy fn') as (address: string) => boolean;
    expect(trust('172.19.0.2')).toBe(true);
    expect(trust('172.19.0.3')).toBe(false);
    expect(trust('198.51.100.25')).toBe(false);
    expect(trust('127.0.0.1')).toBe(true);
  });
  it.each(['textbee', 'brevo'])('recognizes trusted HTTPS for %s, then enforces provider authentication', async provider => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TEXTBEE_WEBHOOK_SECRET', 'fixture-signing-secret-at-least-32');
    vi.stubEnv('BREVO_WEBHOOK_TOKEN', 'fixture-brevo-token-with-at-least-32-characters');
    app.set('trust proxy', ['loopback', '172.19.0.2/32']);
    const rejected = await post(provider, { 'x-forwarded-proto': 'https' });
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).error).not.toContain('HTTPS');
    const authenticated = await post(provider, { 'x-forwarded-proto': 'https',
      ...(provider === 'textbee' ? { 'x-signature': createHmac('sha256', process.env.TEXTBEE_WEBHOOK_SECRET!).update('{}').digest('hex') }
        : { authorization: `Bearer ${process.env.BREVO_WEBHOOK_TOKEN}` }) });
    expect(authenticated.status).toBe(400); // Empty event is invalid, after authentication.
    expect((await authenticated.json()).error).not.toContain('HTTPS');
  });
  it.each(['textbee', 'brevo'])('rejects plain HTTP and spoofed forwarding from an untrusted peer for %s', async provider => {
    vi.stubEnv('NODE_ENV', 'production');
    app.set('trust proxy', ['loopback']);
    expect((await post(provider)).status).toBe(400);
    app.set('trust proxy', ['172.19.0.2/32']); // The local test socket is deliberately untrusted.
    const spoofed = await post(provider, { 'x-forwarded-proto': 'https', 'x-forwarded-for': '172.19.0.2' });
    expect(spoofed.status).toBe(400);
    expect((await spoofed.json()).error).toBe('HTTPS is required.');
  });
});
