/**
 * sw.js — Service Worker for offline caching
 * Caches app shell on install, serves from cache when offline.
 *
 * ⚠️  DEPLOYMENT NOTE: bump CACHE_NAME (e.g. fireflow-v2) every time you
 * deploy changes to any file in SHELL_FILES.  The activate handler deletes
 * all caches whose name doesn't match CACHE_NAME, which forces clients to
 * receive the new shell on their next load.  Forgetting to bump means users
 * with an active service worker may keep running stale JS/CSS.
 */

const CACHE_NAME = 'fireflow-v6';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/offline.js',
  '/js/toast.js',
  // Core modules
  '/js/quote-pdf.js',
  '/js/pricing-config.js',
  '/js/nfpa-checklists.js',
  // Admin views
  '/js/views/login.js',
  '/js/views/admin-dashboard.js',
  '/js/views/admin-pipeline.js',
  '/js/views/admin-inspection-review.js',
  '/js/views/admin-quote-builder.js',
  '/js/views/admin-pricing-config.js',
  // Tech views
  '/js/views/tech-my-day.js',
  '/js/views/tech-inspection.js',
  // Public / customer views
  '/js/views/customer-quote.js',
  '/js/views/signup.js',
  '/js/views/billing.js',
  '/js/views/pricing.js',
];

// Install: cache all shell files
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activate: clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for shell
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always network for API calls
  if (url.pathname.startsWith('/v1') || url.pathname === '/health') {
    e.respondWith(
      fetch(e.request).catch(() => new Response(
        JSON.stringify({ success: false, error: { code: 'OFFLINE', message: 'You are offline' } }),
        { headers: { 'Content-Type': 'application/json' }, status: 503 }
      ))
    );
    return;
  }

  // Cache-first for everything else (shell files)
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        const networkFetch = fetch(e.request)
          .then(response => {
            if (response.ok) {
              caches.open(CACHE_NAME).then(c => c.put(e.request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached ?? networkFetch;
      })
  );
});
