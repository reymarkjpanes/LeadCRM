// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
  const fetch = vi.fn().mockResolvedValue(new Response('asset'));
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn(), delete: vi.fn().mockResolvedValue(true) };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin: 'https://crm.test' }, addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; }, clients: { claim: vi.fn() } },
    URL, Response, fetch, caches,
  });
  return { handlers, fetch, cache, caches };
}

it.each(['/api/proxy/crm/leads', '/crm/leads?_rsc=123', '/dashboard', 'https://another.test/private.json'])(
  'does not intercept dynamic or external data: %s', (path) => {
    const { handlers } = worker();
    const event = { request: { method: 'GET', mode: 'cors', url: new URL(path, 'https://crm.test').href }, respondWith: vi.fn() };
    handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  },
);

it('serves a cached static asset when the background network request fails', async () => {
  const { handlers, fetch, cache } = worker();
  const cached = new Response('cached');
  cache.match.mockResolvedValue(cached);
  fetch.mockRejectedValue(new Error('offline'));
  let response!: Promise<Response>;
  const updates: Promise<void>[] = [];
  handlers.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://crm.test/_next/static/chunk.js' },
    respondWith: (value: Promise<Response>) => { response = value; },
    waitUntil: (value: Promise<void>) => updates.push(value),
  });
  expect(await response).toBe(cached);
  await Promise.all(updates);
});

it('only removes old LeadCRM caches on activation', async () => {
  const { handlers, caches } = worker();
  caches.keys.mockResolvedValue(['leadcrm-cache-v3', 'leadcrm-cache-v4', 'leadcrm-cache-v5', 'another-app-cache']);
  let pending!: Promise<void>;
  handlers.activate({ waitUntil: (value: Promise<void>) => { pending = value; } });
  await pending;
  expect(caches.delete).toHaveBeenCalledTimes(2);
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v3');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v4');
  expect(caches.delete).not.toHaveBeenCalledWith('another-app-cache');
});
