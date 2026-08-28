import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('service worker caches only existing GitHub Pages assets', () => {
  const source = read('sw.js');
  const cacheNameMatch = source.match(/const CACHE_NAME = '([^']+)'/);
  assert.ok(cacheNameMatch);
  assert.equal(cacheNameMatch[1], 'la-taba-runtime-v92-taba-abre-24-horas-y-deja-de-ser-solo-bebida');

  const assetBlock = source.match(/const ASSETS = \[(.*?)\];/s);
  assert.ok(assetBlock);

  const assets = [...assetBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const qaMarker = ['q', 'a', '-'].join('');
  assert.equal(assets.some((asset) => asset.includes(`/${qaMarker}`)), false);
  assert.equal(assets.some((asset) => /(?:^|\/)(?:tests|fixtures)(?:\/|$)/i.test(asset)), false);
  assert.ok(assets.includes('./index.html'));
  assert.ok(assets.includes('./manifest.webmanifest'));
  assert.ok(assets.includes('./assets/icon.svg'));
  assert.ok(assets.includes('./assets/brand/taba2-emblem.svg'));
  assert.ok(assets.includes('./assets/products/beverage-placeholder.svg'));
  assert.equal(
    assets.some((asset) => asset.startsWith('./assets/products/bebidas/')),
    false,
    'obsolete beverage source and preview derivatives must not be precached',
  );
  assert.equal(
    assets.some((asset) => /(?:horno|pizza|parrilla|carne|milanesa|chorizo|combo-familiar|promo-dia|bebida-cola)/i.test(asset)),
    false,
    'legacy food or unverified catalog imagery must not be precached',
  );
  assert.ok(assets.includes('./js/pwa-update.js?v=4'));
  assert.ok(assets.includes('./js/startup-recovery.js?v=2'));
  assert.ok(assets.includes('./styles.css?v=57'));
  assert.ok(assets.includes('./styles/storefront.css?v=57'));
  assert.ok(assets.includes('./styles/responsive.css?v=57'));
  assert.ok(assets.includes('./styles/showcase.css?v=57'));
  assert.ok(assets.includes('./js/app.js?v=49'));
  assert.ok(assets.includes('./pago/resultado/index.html'));
  assert.ok(assets.includes('./pago/pendiente/index.html'));
  assert.ok(assets.includes('./pago/error/index.html'));
  assert.ok(assets.includes('./js/payments/mercadopago-return.js'));
  assert.ok(assets.includes('./js/core/address.js'));
  assert.ok(assets.includes('./js/core/app-mode.js'));
  assert.ok(assets.includes('./js/core/showcase-mode.js'));
  assert.ok(assets.includes('./js/core/customer-addresses.js'));
  // El paso de confirmación de ubicación es parte del camino de compra: si sus
  // módulos no están precacheados, offline el importador no evalúa y el Perfil
  // se cae entero, no sólo el mapa.
  assert.ok(assets.includes('./js/core/delivery-location.js'));
  assert.ok(assets.includes('./js/core/delivery-location-draft.js'));
  assert.ok(assets.includes('./js/delivery-location-step.js'));
  assert.ok(assets.includes('./js/map/location_picker_map.js'));
  assert.ok(assets.includes('./js/core/storage.js'));
  assert.ok(assets.includes('./js/core/storefront-filters.js'));
  assert.ok(assets.includes('./js/core/cart-recommendations.js'));
  assert.ok(assets.includes('./js/core/order-status.js'));
  assert.ok(assets.includes('./js/core/order-workflow.js'));
  assert.ok(assets.includes('./js/core/runtime-config.js'));
  assert.ok(assets.includes('./runtime-config.js'));
  assert.ok(assets.includes('./js/core/domain.js'));
  assert.ok(assets.includes('./js/map/maplibre_tracking_map.js'));
  assert.ok(assets.includes('./js/map/map_view.js'));
  assert.ok(assets.includes('./js/map/route_geometry.js'));
  assert.ok(assets.includes('./js/repositories/repository_factory.js'));
  assert.ok(assets.includes('./js/repositories/demo_order_repository.js'));
  assert.ok(assets.includes('./js/repositories/customer_profile_repository.js'));
  assert.ok(assets.includes('./js/repositories/supabase_order_repository.js'));
  assert.ok(assets.includes('./js/repositories/unavailable_order_repository.js'));
  assert.ok(assets.includes('./js/services/supabase-auth.js'));
  assert.ok(assets.includes('./js/services/supabase-client.js'));
  assert.ok(assets.includes('./js/services/customer-geolocation.js'));
  assert.ok(assets.includes('./js/customer-delivery.js'));
  assert.ok(assets.includes('./js/vendor/supabase.js'));
  assert.ok(assets.includes('./js/production-operations.js'));
  assert.ok(assets.includes('./js/showcase-fixtures.js'));
  assert.ok(assets.includes('./js/showcase.js'));

  for (const asset of assets) {
    if (asset === './') continue;
    assert.equal(fs.existsSync(path.join(root, asset.split('?')[0])), true, `missing asset referenced by sw.js: ${asset}`);
  }
});

test('viewport mobile does not block accessibility zoom', () => {
  const source = read('index.html');
  const viewportMatch = source.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
  assert.ok(viewportMatch, 'missing viewport meta');
  const viewportContent = viewportMatch[1];
  assert.doesNotMatch(viewportContent, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(viewportContent, /maximum-scale\s*=/i);
});

test('commercial app defaults to light premium theme, not dark fallback', () => {
  const source = [
    'styles/tokens.css',
    'styles/common.css',
    'styles/storefront.css',
    'styles/catalog.css',
    'styles/checkout.css',
    'styles/tracking.css',
    'styles/business.css',
    'styles/rider.css',
    'styles/responsive.css',
  ].map(read).join('\n');
  const rootBlock = source.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlock);
  assert.match(rootBlock[1], /color-scheme:\s*light/);
  assert.doesNotMatch(source, /color-scheme:\s*dark/);
});

test('service worker fallback is guarded to navigation requests only', () => {
  const source = read('sw.js');
  // El respaldo a `index.html` sigue siendo exclusivo de las navegaciones: un
  // subrecurso que no está en la caché NO puede recibir el shell de la tienda
  // disfrazado de módulo o de hoja de estilos. El comportamiento —y no sólo la
  // forma del fuente— lo fija tests/service-worker-degraded-edge.test.mjs.
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /caches\.match\('\.\/index\.html'\)/);
  assert.match(source, /Response\.error\(\)/);
});

test('service worker sólo elimina caches anteriores de TABA y exige precache completo', () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE_PREFIX = 'la-taba-runtime-';/);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
  assert.doesNotMatch(
    source,
    /cache\.addAll\(ASSETS\)\)\.catch\(\(\) => undefined\)/,
  );
});

test('a published update waits for an explicit customer refresh instead of interrupting the journey', () => {
  const worker = read('sw.js');
  const update = read('js/pwa-update.js');
  const installBlock = worker.match(/self\.addEventListener\('install',[\s\S]*?\n}\);/);
  assert.ok(installBlock);
  assert.doesNotMatch(installBlock[0], /skipWaiting\(\)/);
  assert.match(worker, /event\.data === 'skip-waiting'/);
  assert.match(update, /data-app-update-banner/);
  assert.match(update, /waiting\.postMessage\('skip-waiting'\)/);
  assert.match(update, /register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.match(update, /controllerchange/);
  assert.match(update, /registration\.update\(\)\.then\(\(\) => syncUpdate\(registration\)\)/);
  assert.match(update, /const UPDATE_CHECK_DELAYS = \[0, 250, 1000, 4000, 12000, 30000, 60000\]/);
  assert.match(update, /scheduleWaitingUpdateChecks\(registration\)/);
  assert.match(update, /window\.addEventListener\('focus', recheckUpdate\)/);
  assert.match(update, /window\.addEventListener\('pageshow', recheckUpdate\)/);
  // El aviso tiene que poder RETIRARSE, no sólo mostrarse: sin esto vuelve el
  // defecto que dejaba la banda fija comiéndose el toque de «Agregar».
  assert.match(update, /const syncUpdate = \(registration\) => \{/);
  assert.match(update, /data-app-update-dismiss/);
  assert.match(read('index.html'), /data-app-update-dismiss/);
});

test('MapLibre GL remoto está fijado con SRI y CORS anónimo', () => {
  const source = read('index.html');
  assert.match(
    source,
    /href="https:\/\/unpkg\.com\/maplibre-gl@5\.24\.0\/dist\/maplibre-gl\.css"[\s\S]*?integrity="sha384-uTttxo\/aOKbdE5RlD\/SPzSDoDmNvGlUYPjONi2MN\/b7c9HPSvW07OIuyP7uL6jxK"[\s\S]*?crossorigin="anonymous"/,
  );
  assert.match(
    source,
    /src="https:\/\/unpkg\.com\/maplibre-gl@5\.24\.0\/dist\/maplibre-gl\.js"[\s\S]*?integrity="sha384-5\+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp"[\s\S]*?crossorigin="anonymous"/,
  );
});
