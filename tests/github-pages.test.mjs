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
  assert.equal(cacheNameMatch[1], 'la-taba-pizzeria-v7-honesty-cache');

  const assetBlock = source.match(/const ASSETS = \[(.*?)\];/s);
  assert.ok(assetBlock);

  const assets = [...assetBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(assets.includes('./index.html'));
  assert.ok(assets.includes('./manifest.webmanifest'));
  assert.ok(assets.includes('./assets/icon.svg'));
  assert.ok(assets.includes('./assets/hero/horno-lena.webp'));
  assert.ok(assets.includes('./assets/products/pizza-muzzarella.webp'));
  assert.ok(assets.includes('./js/app.js'));
  assert.ok(assets.includes('./js/core/address.js'));
  assert.ok(assets.includes('./js/core/app-mode.js'));
  assert.ok(assets.includes('./js/core/storage.js'));
  assert.ok(assets.includes('./js/core/order-status.js'));
  assert.ok(assets.includes('./js/core/order-workflow.js'));
  assert.ok(assets.includes('./js/core/domain.js'));
  assert.ok(assets.includes('./js/map/map_view.js'));
  assert.ok(assets.includes('./js/map/route_geometry.js'));
  assert.ok(assets.includes('./js/repositories/repository_factory.js'));
  assert.ok(assets.includes('./js/repositories/demo_order_repository.js'));
  assert.ok(assets.includes('./js/repositories/supabase_order_repository.js'));

  for (const asset of assets) {
    if (asset === './') continue;
    assert.equal(fs.existsSync(path.join(root, asset)), true, `missing asset referenced by sw.js: ${asset}`);
  }
});

test('commercial app defaults to light premium theme, not dark fallback', () => {
  const source = read('styles.css');
  const rootBlock = source.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootBlock);
  assert.match(rootBlock[1], /color-scheme:\s*light/);
  assert.doesNotMatch(rootBlock[1], /color-scheme:\s*dark/);
  assert.match(source, /body:has\(\.app-view\[data-view="rider"\]\.is-active\)\s*\{[\s\S]*color-scheme:\s*dark/);
});

test('service worker fallback is guarded to navigation requests only', () => {
  const source = read('sw.js');
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /return caches\.match\('\.\/index\.html'\);/);
  assert.match(source, /return Response\.error\(\);/);
});
