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
  assert.equal(cacheNameMatch[1], 'la-taba-runtime-v12-commercial-cache');

  const assetBlock = source.match(/const ASSETS = \[(.*?)\];/s);
  assert.ok(assetBlock);

  const assets = [...assetBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(assets.includes('./index.html'));
  assert.ok(assets.includes('./manifest.webmanifest'));
  assert.ok(assets.includes('./assets/icon.svg'));
  assert.ok(assets.includes('./assets/products/beverage-placeholder.svg'));
  assert.equal(
    assets.some((asset) => /(?:horno|pizza|parrilla|carne|milanesa|chorizo|combo-familiar|promo-dia|bebida-cola)/i.test(asset)),
    false,
    'legacy food or unverified catalog imagery must not be precached',
  );
  assert.ok(assets.includes('./js/app.js'));
  assert.ok(assets.includes('./js/core/address.js'));
  assert.ok(assets.includes('./js/core/app-mode.js'));
  assert.ok(assets.includes('./js/core/storage.js'));
  assert.ok(assets.includes('./js/core/order-status.js'));
  assert.ok(assets.includes('./js/core/order-workflow.js'));
  assert.ok(assets.includes('./js/core/runtime-config.js'));
  assert.ok(assets.includes('./runtime-config.js'));
  assert.ok(assets.includes('./js/core/domain.js'));
  assert.ok(assets.includes('./js/map/map_view.js'));
  assert.ok(assets.includes('./js/map/route_geometry.js'));
  assert.ok(assets.includes('./js/repositories/repository_factory.js'));
  assert.ok(assets.includes('./js/repositories/demo_order_repository.js'));
  assert.ok(assets.includes('./js/repositories/supabase_order_repository.js'));
  assert.ok(assets.includes('./js/repositories/unavailable_order_repository.js'));
  assert.ok(assets.includes('./js/services/supabase-auth.js'));
  assert.ok(assets.includes('./js/services/supabase-client.js'));
  assert.ok(assets.includes('./js/vendor/supabase.js'));
  assert.ok(assets.includes('./js/production-operations.js'));

  for (const asset of assets) {
    if (asset === './') continue;
    assert.equal(fs.existsSync(path.join(root, asset)), true, `missing asset referenced by sw.js: ${asset}`);
  }
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
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /return caches\.match\('\.\/index\.html'\);/);
  assert.match(source, /return Response\.error\(\);/);
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

test('Leaflet remoto está fijado con SRI y CORS anónimo', () => {
  const source = read('index.html');
  assert.match(
    source,
    /href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"[\s\S]*?integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="[\s\S]*?crossorigin=""/,
  );
  assert.match(
    source,
    /src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"[\s\S]*?integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="[\s\S]*?crossorigin=""/,
  );
});
