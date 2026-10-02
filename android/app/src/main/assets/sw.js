// Virginia Teen Driving Log Service Worker
// Cache-First strategy for 100% offline reliability on Pixel 11 Pro

const CACHE_NAME = 'va-driving-log-v1.1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Install: Cache essential assets immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Serve from cache first, fallback to network
self.addEventListener('fetch', (event) => {
  // Do not intercept non-GET requests or WebDAV sync requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // If request is for external API / WebDAV, let it go straight to network
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset, fetch in background to update cache if online (stale-while-revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {
          // Offline, ignore network error
        });
        return cachedResponse;
      }
      return fetch(event.request);
    }).catch(() => {
      // Offline fallback
      return caches.match('./index.html');
    })
  );
});
