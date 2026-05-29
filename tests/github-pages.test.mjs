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
  assert.equal(cacheNameMatch[1], 'la-taba-v4-3-cache');

  const assetBlock = source.match(/const ASSETS = \[(.*?)\];/s);
  assert.ok(assetBlock);

  const assets = [...assetBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(assets.includes('./index.html'));
  assert.ok(assets.includes('./manifest.webmanifest'));
  assert.ok(assets.includes('./assets/icon.svg'));
  assert.ok(assets.includes('./js/app.js'));
  assert.ok(assets.includes('./js/core/storage.js'));
  assert.ok(assets.includes('./js/core/order-status.js'));

  for (const asset of assets) {
    if (asset === './') continue;
    assert.equal(fs.existsSync(path.join(root, asset)), true, `missing asset referenced by sw.js: ${asset}`);
  }
});

test('service worker fallback is guarded to navigation requests only', () => {
  const source = read('sw.js');
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /return caches\.match\('\.\/index\.html'\);/);
  assert.match(source, /return Response\.error\(\);/);
});
