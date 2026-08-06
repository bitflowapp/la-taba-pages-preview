import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { products } from '../js/approved-beverage-demo-data.js';
import { getCustomerCatalogProducts, isProductOrderable, normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { defaultCatalogFilters, normalizeCatalogFilters } from '../js/state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('TABA2 keeps price-pending products non-purchasable without a zero price', () => {
  const pending = products.find((product) => product.sku === 'red-bull-original-lata-250ml-pack-4');
  const normalized = normalizeCatalogProduct(pending);
  assert.equal(pending.price, null);
  assert.equal(normalized.price, null);
  assert.equal(normalized.priceStatus, 'pending');
  assert.equal(isProductOrderable(normalized), false);
});

test('TABA2 excludes a pack with an image-identity collision from customer catalog', () => {
  const rejected = products.find((product) => product.sku === 'heineken-original-lata-473ml-pack-6');
  assert.equal(rejected.archived, true);
  assert.equal(rejected.imageQualityStatus, 'rejected_duplicate_identity');
  assert.ok(!getCustomerCatalogProducts(products).some((product) => product.sku === rejected.sku));
});

test('commercial filter state accepts only supported values and defaults safely', () => {
  assert.deepEqual(defaultCatalogFilters(), {
    brand: 'all', capacity: 'all', presentation: 'all', pack: 'all', alcohol: 'all',
    availability: 'all', price: 'all', promotion: 'all',
  });
  assert.deepEqual(normalizeCatalogFilters({ alcohol: 'with', price: 'pending', pack: 'invalid' }), {
    brand: 'all', capacity: 'all', presentation: 'all', pack: 'all', alcohol: 'with',
    availability: 'all', price: 'pending', promotion: 'all',
  });
});

test('versioned catalog evidence and normalized price handoff are present', () => {
  for (const relative of [
    'catalog/products.json',
    'catalog/pending-prices.csv',
    'catalog/image-sources.csv',
    'catalog/publication-readiness.csv',
    'catalog/review-queue.csv',
  ]) assert.ok(fs.existsSync(path.join(root, relative)), relative);
  const handoff = fs.readFileSync(path.join(root, 'catalog/pending-prices.csv'), 'utf8');
  assert.match(handoff, /price_status/);
  assert.match(handoff, /pending/);
  assert.doesNotMatch(handoff, /,0(?:,|\r?\n)/);
});

test('public storefront shell separates the product name from the business name', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
  // Producto/plataforma: TABA2. No cambia con el comercio.
  assert.match(html, /<title>TABA2 · Tienda de bebidas<\/title>/);
  assert.match(manifest, /"short_name": "TABA2"/);
  // Comercio: el fallback de primer pintado dice el nombre del local y luego
  // `applyBusinessConfig` lo reemplaza con el valor real de la config.
  assert.match(html, /data-business-name>La Taba 2</);
  assert.doesNotMatch(html, /data-business-name>TABA</);
});
