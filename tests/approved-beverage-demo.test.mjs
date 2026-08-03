import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { products } from '../js/approved-beverage-demo-data.js';
import { pendingProducts } from '../js/taba2-commercial-pending-data.js';
import { isProductOrderable, normalizeCatalogProduct } from '../js/core/catalog-store.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_SKUS = [
  'coca-cola-original-pet-500ml-pack-12',
  'coca-cola-zero-pet-500ml-pack-12',
  'sprite-original-pet-500ml-pack-12',
  'coca-cola-original-pet-1500ml-pack-6',
  'coca-cola-zero-pet-1500ml-pack-6',
  'sprite-original-pet-1500ml-pack-6',
  'fanta-naranja-pet-1500ml-pack-6',
  'schweppes-tonica-pet-1500ml-pack-6',
  'schweppes-citrus-pet-1500ml-pack-6',
  'red-bull-original-lata-250ml',
  'red-bull-original-lata-250ml-pack-4',
  'speed-original-lata-473ml',
  'speed-zero-lata-473ml',
  'monster-mango-loco-lata-473ml',
  'heineken-original-lata-473ml',
  'heineken-original-lata-473ml-pack-6',
  'imperial-golden-lata-473ml',
  'imperial-extra-lager-lata-473ml',
  'imperial-apa-lata-473ml',
  'imperial-cream-stout-lata-473ml',
  'schneider-rubia-lata-710ml',
  'corona-extra-botella-330ml',
];

test('el catálogo demo aprobado contiene exactamente los 22 SKU locales', () => {
  assert.equal(products.length, EXPECTED_SKUS.length + pendingProducts.length);
  assert.ok(pendingProducts.length >= 60);
  assert.deepEqual(products.slice(0, EXPECTED_SKUS.length).map((product) => product.sku), EXPECTED_SKUS);
  assert.equal(new Set(products.map((product) => product.sku)).size, products.length);
  assert.ok(products.every((product) => product.image.startsWith('assets/catalog/beverages/') || product.image.startsWith('assets/catalog/products/')));
  assert.ok(products.every((product) => product.imageThumbnail.startsWith('assets/catalog/beverages/') || product.imageThumbnail.startsWith('assets/catalog/products/')));
  assert.ok(products.every((product) => !product.sku.startsWith('qa-')));
  assert.ok(products.every((product) => !`${product.image} ${product.imageThumbnail}`.includes('/qa-')));
  assert.ok(products.every((product) => !/^https?:/i.test(product.image) && !/^https?:/i.test(product.imageThumbnail)));
  assert.ok(products.every((product) => !/\b(?:pending|unresolved)\b/i.test(`${product.image} ${product.imageThumbnail}`)));
  const assets = products.flatMap((product) => [product.image, product.imageThumbnail]);
  assert.equal(assets.length, products.length * 2);
  assert.equal(new Set(assets).size, assets.length);
  for (const product of products) {
    assert.ok(fs.statSync(path.join(ROOT, product.image)).size > 0, `${product.sku}: product.webp`);
    assert.ok(fs.statSync(path.join(ROOT, product.imageThumbnail)).size > 0, `${product.sku}: thumbnail.webp`);
  }
});

test('packs, precios pendientes y alcohol conservan su semántica comercial', () => {
  const catalog = products.map((product) => normalizeCatalogProduct(product)).filter(Boolean);
  assert.equal(catalog.length, products.length);
  assert.equal(new Set(catalog.map((product) => product.sku)).size, products.length);
  const packSix = catalog.find((product) => product.sku === 'heineken-original-lata-473ml-pack-6');
  const packTwelve = catalog.find((product) => product.sku === 'coca-cola-original-pet-500ml-pack-12');
  const pending = catalog.find((product) => product.sku === 'red-bull-original-lata-250ml-pack-4');
  assert.deepEqual([packSix.unitLabel, packSix.unitsPerPack], ['Pack x6', 6]);
  assert.equal(packSix.archived, true);
  assert.equal(isProductOrderable(packSix), false);
  assert.deepEqual([packTwelve.unitLabel, packTwelve.unitsPerPack], ['Pack x12', 12]);
  assert.equal(pending.pricePending, true);
  assert.equal(pending.price, null);
  assert.equal(pending.oldPrice, undefined);
  assert.equal(pending.badge, undefined);
  assert.equal(isProductOrderable(pending), false);
  assert.ok(catalog.filter((product) => product.alcoholic).every((product) => product.requiresAgeConfirmation && product.minimumAge === 18));
  assert.ok(catalog.filter((product) => !product.alcoholic).every((product) => !product.requiresAgeConfirmation));
});
