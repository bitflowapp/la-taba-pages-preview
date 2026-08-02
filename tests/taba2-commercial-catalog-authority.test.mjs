import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { products as runtimeProducts } from '../js/approved-beverage-demo-data.js';
import { isProductOrderable, normalizeCatalogProduct } from '../js/core/catalog-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog/products.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'catalog/image-manifest.json'), 'utf8'));
const approved = catalog.filter((product) => product.catalog_status === 'approved');

test('TABA2 authority catalog has 40 identity-approved, price-pending internal-review SKUs', () => {
  assert.equal(approved.length, 40);
  assert.equal(new Set(approved.map((product) => product.sku)).size, approved.length);
  assert.equal(new Set(approved.map((product) => `${product.brand}|${product.name}|${product.variant}|${product.presentation}`)).size, approved.length);
  for (const product of approved) {
    assert.equal(product.price, null, product.sku);
    assert.equal(product.regular_price, null, product.sku);
    assert.equal(product.price_status, 'pending', product.sku);
    assert.equal(product.catalog_status, 'approved', product.sku);
    assert.equal(product.image_status, 'verified', product.sku);
    assert.equal(product.rights_status, 'pending_review', product.sku);
    assert.equal(product.publication_status, 'blocked', product.sku);
    assert.equal(product.pack_count, 1, product.sku);
    assert.equal(product.gtin, '', product.sku);
    assert.ok(product.brand && product.variant && product.presentation && product.capacity_value > 0, product.sku);
    assert.ok(product.image_source.source_url.startsWith('https://www.jumbo.com.ar/'), product.sku);
    assert.equal(product.image_source.source_type, 'cadena_comercial_secundaria', product.sku);
    assert.match(product.image_sha256, /^[a-f0-9]{64}$/i, product.sku);
  }
});

test('TABA2 masters and thumbnails are unique, local, WebP, sRGB and white-backed', async () => {
  assert.equal(manifest.sources.length, approved.length);
  const hashes = new Set();
  const sourceHashes = new Set();
  for (const product of approved) {
    const source = manifest.sources.find((candidate) => candidate.sku === product.sku);
    assert.ok(source, product.sku);
    assert.ok(!sourceHashes.has(source.source_sha256), `${product.sku}: source collision`);
    sourceHashes.add(source.source_sha256);
    for (const [kind, expected] of [['master', 1000], ['thumbnail', 400]]) {
      const asset = source[kind];
      assert.ok(asset.path.endsWith(`/${product.sku}-${kind === 'master' ? 'master' : 'thumb'}.webp`), product.sku);
      assert.ok(!hashes.has(asset.sha256), `${product.sku}: asset collision`);
      hashes.add(asset.sha256);
      const absolute = path.join(root, asset.path);
      const bytes = await fs.readFile(absolute);
      assert.equal(asset.sha256, (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'), product.sku);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'webp', product.sku);
      assert.equal(metadata.width, expected, product.sku);
      assert.equal(metadata.height, expected, product.sku);
      assert.equal(metadata.space, 'srgb', product.sku);
      const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([...data.subarray(0, 4)], [255, 255, 255, 255], `${product.sku}: top-left must be white`);
    }
  }
});

test('price-pending authority products can be searched but cannot enter the commercial flow', () => {
  const pendingRuntime = runtimeProducts.filter((product) => product.catalogStatus === 'approved');
  assert.equal(pendingRuntime.length, approved.length);
  for (const product of pendingRuntime) {
    const normalized = normalizeCatalogProduct(product);
    assert.equal(normalized.price, null, product.sku);
    assert.equal(normalized.pricePending, true, product.sku);
    assert.equal(isProductOrderable(normalized), false, product.sku);
    assert.equal(product.available, false, product.sku);
    assert.equal(product.stock, 0, product.sku);
    assert.ok(!product.badge && !product.oldPrice, product.sku);
  }
});

test('legacy Heineken x6 rejection remains an explicit non-reusable collision decision', () => {
  const rejected = catalog.find((product) => product.sku === 'heineken-original-lata-473ml-pack-6');
  assert.equal(rejected.catalog_status, 'rejected');
  assert.match(rejected.notes, /colisi.n|comparte/i);
  assert.ok(!approved.some((product) => product.sku === rejected.sku));
});
