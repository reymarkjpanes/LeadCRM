const CACHE_NAME = 'leadcrm-cache-v5';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/leadcrm-192.png',
  '/icons/leadcrm-512.png',
  '/icons/leadcrm-maskable-512.png'
];

// ── Install: pre-cache critical static assets ─────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('leadcrm-cache-') && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API & navigation,
//           stale-while-revalidate for static assets ────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API requests — always go to network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests — network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then(cached =>
          cached || new Response(
            'You are offline. LeadCRM requires an internet connection to sync data.',
            { headers: { 'Content-Type': 'text/html' } }
          )
        )
      )
    );
    return;
  }

  // Only cache known public assets. In particular, Next.js RSC/prefetch requests
  // are fetches to page URLs, not navigations, and must never enter this cache.
  const isPublicAsset = url.origin === self.location.origin && (
    url.pathname.startsWith('/_next/static/') ||
    STATIC_ASSETS.includes(url.pathname) ||
    ['/leadcrm_logo.png', '/leadcrm_logo.ico'].includes(url.pathname)
  );
  if (!isPublicAsset) return;

  // Static assets — stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(async response => {
          if (response.ok && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
            // A full or unavailable cache must not break a successful network response.
            await cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        });
        // Keep the update alive and handle an offline refresh of a cache hit.
        event.waitUntil(networkFetch.then(() => undefined, () => undefined));
        return cached || networkFetch;
      })
    )
  );
});
