const CACHE_PREFIX = 'la-taba-runtime-';
const CACHE_NAME = 'la-taba-runtime-v35-beverage-home-final';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=35',
  './styles/tokens.css?v=35',
  './styles/common.css?v=35',
  './styles/storefront.css?v=35',
  './styles/catalog.css?v=35',
  './styles/checkout.css?v=35',
  './styles/tracking.css?v=35',
  './styles/business.css?v=35',
  './styles/rider.css?v=35',
  './styles/responsive.css?v=35',
  './manifest.webmanifest',
  './runtime-config.js',
  './assets/icon.svg',
  './assets/products/beverage-placeholder.svg',
  './assets/catalog/products/qa-coca-cola-original-15l-aa70012decc566a8-1d824eec5604643f.webp',
  './assets/catalog/thumbnails/qa-coca-cola-original-15l-aa70012decc566a8-thumb-ea9fe78055613651.webp',
  './assets/catalog/products/qa-sprite-15l-1989810f07a2c3ef-da1929408b8b0643.webp',
  './assets/catalog/thumbnails/qa-sprite-15l-1989810f07a2c3ef-thumb-1676fdfe37e31ebf.webp',
  './assets/catalog/products/qa-fanta-naranja-15l-40851f95ab71b216-e41698f0e9b8788b.webp',
  './assets/catalog/thumbnails/qa-fanta-naranja-15l-40851f95ab71b216-thumb-6f5544d252c1151c.webp',
  './assets/catalog/products/qa-monster-green-473ml-c7a66ed57c1f8268-0c999ce7e48f3aca.webp',
  './assets/catalog/thumbnails/qa-monster-green-473ml-c7a66ed57c1f8268-thumb-883c78950d69aa9d.webp',
  './js/pwa-update.js?v=2',
  './js/startup-recovery.js?v=1',
  './js/app.js?v=31',
  './js/config.js',
  './js/core/address.js',
  './js/core/app-mode.js',
  './js/core/business-config-store.js',
  './js/core/business-metrics.js',
  './js/core/business-ops.js',
  './js/core/business-reports.js',
  './js/core/business-setup.js',
  './js/core/cashbox-store.js',
  './js/core/catalog-store.js',
  './js/core/customer-addresses.js',
  './js/core/customer-history.js',
  './js/core/customer-preferences.js',
  './js/core/customer-profile.js',
  './js/core/delivery-code.js',
  './js/core/delivery-proof.js',
  './js/core/domain.js',
  './js/core/loyalty.js',
  './js/core/order-status.js',
  './js/core/order-timeline.js',
  './js/core/order-workflow.js',
  './js/core/pricing.js',
  './js/core/promotions.js',
  './js/core/pwa-install.js',
  './js/core/realtime-sync.js',
  './js/core/reorder.js',
  './js/core/rider.js',
  './js/core/runtime-config.js',
  './js/core/simulation.js',
  './js/core/storage.js',
  './js/core/validators.js',
  './js/sandbox/sandbox_map_scenario.js',
  './js/map/map_config.js',
  './js/map/maplibre_tracking_map.js',
  './js/map/map_view.js',
  './js/map/rider_marker.js',
  './js/map/route_geometry.js',
  './js/data.js',
  './js/beverage-qa-data.js',
  './js/state.js',
  './js/cart.js',
  './js/customer-delivery.js',
  './js/orders.js',
  './js/repositories/demo_order_repository.js',
  './js/repositories/http_order_repository.js',
  './js/repositories/order_repository.js',
  './js/repositories/realtime_order_repository.js',
  './js/repositories/repository_factory.js',
  './js/repositories/storage_repository.js',
  './js/repositories/customer_profile_repository.js',
  './js/repositories/supabase_order_repository.js',
  './js/repositories/unavailable_order_repository.js',
  './js/services/supabase-auth.js',
  './js/services/supabase-client.js',
  './js/services/customer-geolocation.js',
  './js/vendor/supabase.js',
  './js/business.js',
  './js/delivery.js',
  './js/production-operations.js',
  './js/realtime.js',
  './js/simulation.js',
  './js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // La instalación de un worker nuevo puede ejecutarse mientras el anterior
    // todavía controla la pestaña. `reload` evita precachear módulos viejos
    // desde la caché HTTP y permite que “Actualizar ahora” entregue el bundle
    // que acaba de publicarse.
    caches.open(CACHE_NAME).then((cache) => cache.addAll(
      ASSETS.map((asset) => new Request(asset, { cache: 'reload' })),
    )),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
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
