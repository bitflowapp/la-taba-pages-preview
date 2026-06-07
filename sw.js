const CACHE_NAME = 'la-taba-v5-8-cache';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/hero/parrilla-real.webp',
  './assets/products/chorizos-parrilla.webp',
  './assets/products/cortes-crudos.webp',
  './assets/products/hamburguesa.webp',
  './assets/products/milanesas.webp',
  './assets/products/pollo-fresco.webp',
  './js/app.js',
  './js/config.js',
  './js/core/address.js',
  './js/core/business-config-store.js',
  './js/core/business-metrics.js',
  './js/core/business-ops.js',
  './js/core/business-reports.js',
  './js/core/business-setup.js',
  './js/core/cashbox-store.js',
  './js/core/catalog-store.js',
  './js/core/customer-history.js',
  './js/core/customer-preferences.js',
  './js/core/delivery-proof.js',
  './js/core/domain.js',
  './js/core/order-status.js',
  './js/core/order-workflow.js',
  './js/core/pricing.js',
  './js/core/promotions.js',
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
  './js/repositories/demo_order_repository.js',
  './js/repositories/http_order_repository.js',
  './js/repositories/order_repository.js',
  './js/repositories/realtime_order_repository.js',
  './js/repositories/repository_factory.js',
  './js/repositories/storage_repository.js',
  './js/repositories/supabase_order_repository.js',
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
