// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined), addAll: vi.fn().mockResolvedValue(undefined) };
  const fetch = vi.fn().mockResolvedValue(new Response('asset'));
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn(), delete: vi.fn().mockResolvedValue(true) };
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin: 'https://crm.test' }, addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; }, clients: { claim: vi.fn() }, skipWaiting },
    URL, Response, fetch, caches,
  });
  return { handlers, fetch, cache, caches, skipWaiting };
}

it('precaches the offline document, branding, manifest and installation icons', async () => {
  const { handlers, cache, caches, skipWaiting } = worker();
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  let pending!: Promise<void>;
  handlers.install({ waitUntil: (value: Promise<void>) => { pending = value; } });
  await pending;
  expect(caches.open).toHaveBeenCalledWith('leadcrm-cache-v11');
  expect(cache.addAll).toHaveBeenCalledWith(expect.arrayContaining([
    '/offline.html', '/camxian_logo.png', '/camxian_logo_2.png',
    '/manifest.json', '/favicon.ico', '/favicon.ico?v=camxian-circle-1',
    '/icons/camxian-180.png', '/icons/camxian-180.png?v=camxian-circle-2',
    '/icons/camxian-192.png', '/icons/camxian-512.png', '/icons/camxian-maskable-512.png',
    ...manifest.icons.map((icon: { src: string }) => icon.src),
  ]));
  expect(skipWaiting).toHaveBeenCalledOnce();
});

it.each(['/api/proxy/crm/leads', '/crm/leads?_rsc=123', '/dashboard', 'https://another.test/private.json'])(
  'does not intercept dynamic or external data: %s', (path) => {
    const { handlers } = worker();
    const event = { request: { method: 'GET', mode: 'cors', url: new URL(path, 'https://crm.test').href }, respondWith: vi.fn() };
    handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  },
);

it.each([
  { method: 'POST', mode: 'navigate', path: '/crm/leads' },
  { method: 'PUT', mode: 'cors', path: '/api/proxy/crm/leads' },
  { method: 'GET', mode: 'navigate', path: '/api/proxy/crm/leads' },
])('does not intercept $method $path ($mode)', ({ method, mode, path }) => {
  const { handlers } = worker();
  const respondWith = vi.fn();
  handlers.fetch({ request: { method, mode, url: `https://crm.test${path}` }, respondWith });
  expect(respondWith).not.toHaveBeenCalled();
});

it('serves only the cached offline document when a nested navigation fails', async () => {
  const { handlers, fetch, cache, caches } = worker();
  const offline = new Response(readFileSync('public/offline.html', 'utf8'), { headers: { 'Content-Type': 'text/html' } });
  cache.match.mockResolvedValue(offline);
  fetch.mockRejectedValue(new Error('offline'));
  const request = { method: 'GET', mode: 'navigate', url: 'https://crm.test/crm/leads/123?tab=activity' };
  let response!: Promise<Response>;
  handlers.fetch({ request, respondWith: (value: Promise<Response>) => { response = value; } });
  expect(await response).toBe(offline);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(request);
  expect(caches.open).toHaveBeenCalledWith('leadcrm-cache-v11');
  expect(cache.match).toHaveBeenCalledExactlyOnceWith('/offline.html');
  expect(cache.put).not.toHaveBeenCalled();
});

it.each([200, 401, 500])('returns the network navigation response unchanged (%s), without caching it', async status => {
  const { handlers, fetch, cache, caches } = worker();
  const online = new Response('network response', { status, headers: { 'Cache-Control': 'private, no-store' } });
  fetch.mockResolvedValue(online);
  let response!: Promise<Response>;
  handlers.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://crm.test/dashboard' },
    respondWith: (value: Promise<Response>) => { response = value; },
  });
  expect(await response).toBe(online);
  expect(caches.open).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it('returns a network error if the offline document has been evicted', async () => {
  const { handlers, fetch } = worker();
  fetch.mockRejectedValue(new Error('offline'));
  let response!: Promise<Response>;
  handlers.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://crm.test/dashboard' },
    respondWith: (value: Promise<Response>) => { response = value; },
  });
  expect((await response).type).toBe('error');
});

it.each([
  '/offline.html', '/camxian_logo.png',
  '/_next/static/chunk.js', '/favicon.ico', '/favicon.ico?v=camxian-circle-1',
  '/icons/camxian-180.png?v=camxian-circle-2', '/icons/camxian-192.png?v=camxian-circle-2',
  '/icons/camxian-512.png?v=camxian-circle-2', '/icons/camxian-maskable-512.png?v=camxian-circle-2',
])('serves the exact cached asset offline: %s', async (path) => {
  const { handlers, fetch, cache } = worker();
  const cached = new Response('cached');
  cache.match.mockResolvedValue(cached);
  fetch.mockRejectedValue(new Error('offline'));
  let response!: Promise<Response>;
  const updates: Promise<void>[] = [];
  handlers.fetch({
    request: { method: 'GET', mode: 'cors', url: new URL(path, 'https://crm.test').href },
    respondWith: (value: Promise<Response>) => { response = value; },
    waitUntil: (value: Promise<void>) => updates.push(value),
  });
  expect(await response).toBe(cached);
  expect(cache.match).toHaveBeenCalledWith(expect.objectContaining({ url: new URL(path, 'https://crm.test').href }));
  await Promise.all(updates);
});

it.each(['private', 'no-store', 'private, max-age=60'])('never caches a static response marked %s', async cacheControl => {
  const { handlers, fetch, cache } = worker();
  const online = new Response('private response', { headers: { 'Cache-Control': cacheControl } });
  fetch.mockResolvedValue(online);
  let response!: Promise<Response>;
  const updates: Promise<void>[] = [];
  handlers.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://crm.test/_next/static/chunk.js' },
    respondWith: (value: Promise<Response>) => { response = value; },
    waitUntil: (value: Promise<void>) => updates.push(value),
  });
  expect(await response).toBe(online);
  await Promise.all(updates);
  expect(cache.put).not.toHaveBeenCalled();
});

it('only removes old LeadCRM caches on activation', async () => {
  const { handlers, caches } = worker();
  caches.keys.mockResolvedValue(['leadcrm-cache-v3', 'leadcrm-cache-v4', 'leadcrm-cache-v5', 'leadcrm-cache-v6', 'leadcrm-cache-v7', 'leadcrm-cache-v8', 'leadcrm-cache-v9', 'leadcrm-cache-v10', 'leadcrm-cache-v11', 'another-app-cache']);
  let pending!: Promise<void>;
  handlers.activate({ waitUntil: (value: Promise<void>) => { pending = value; } });
  await pending;
  expect(caches.delete).toHaveBeenCalledTimes(8);
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v3');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v4');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v5');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v6');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v7');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v8');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v9');
  expect(caches.delete).toHaveBeenCalledWith('leadcrm-cache-v10');
  expect(caches.delete).not.toHaveBeenCalledWith('leadcrm-cache-v11');
  expect(caches.delete).not.toHaveBeenCalledWith('another-app-cache');
});
