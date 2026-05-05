// Counter PWA service worker — minimal cache-first strategy for the
// counter shell. Lets the page open even on a flaky cellular connection.
// API calls are NOT cached — they always go through to the network.

const CACHE_NAME = 'counter-v1';
const SHELL = ['/rental/counter', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache API or upload calls.
  if (url.pathname.startsWith('/api/')) return;
  // Cache shell + same-origin navigations only.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached
        ? cached
        : fetch(event.request).then((res) => {
            // Stash navigations + scripts/styles in cache for next visit.
            if (
              res.status === 200 &&
              (res.type === 'basic' || res.type === 'cors') &&
              (event.request.mode === 'navigate' ||
                /\.(js|css|woff2?|ttf|otf|png|jpg|svg)$/i.test(url.pathname))
            ) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(() => {});
            }
            return res;
          }).catch(() => caches.match('/rental/counter'))
    )
  );
});
