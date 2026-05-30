const CACHE_NAME = 'la-taba-v5-2-cache';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './js/app.js',
  './js/config.js',
  './js/core/business-metrics.js',
  './js/core/order-status.js',
  './js/core/pricing.js',
  './js/core/realtime-sync.js',
  './js/core/rider.js',
  './js/core/simulation.js',
  './js/core/storage.js',
  './js/core/validators.js',
  './js/map/map_config.js',
  './js/map/map_view.js',
  './js/map/rider_marker.js',
  './js/map/route_geometry.js',
  './js/data.js',
  './js/state.js',
  './js/cart.js',
  './js/orders.js',
  './js/business.js',
  './js/delivery.js',
  './js/realtime.js',
  './js/simulation.js',
  './js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Permite forzar la activación inmediata de un SW nuevo desde la página.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Network-first: el contenido fresco gana; el cache es solo respaldo offline.
// Así una nueva versión publicada en GitHub Pages se ve sin trucos de "borrar caché".
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })),
  );
});
