import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { products } from '../js/approved-beverage-demo-data.js';
import { isProductOrderable, normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { APPROVED_DEMO_BASE_SKUS, APPROVED_DEMO_BASE_PRODUCT_COUNT } from '../scripts/approved-demo-base-skus.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXPECTED_SKUS = APPROVED_DEMO_BASE_SKUS;

test('catalogo demo aprobado conserva el set base y escala sin depender de un total fijo', () => {
  assert.ok(products.length >= APPROVED_DEMO_BASE_PRODUCT_COUNT, `Se esperan al menos ${APPROVED_DEMO_BASE_PRODUCT_COUNT} productos, encontramos ${products.length}`);
  assert.deepEqual(
    EXPECTED_SKUS.every((sku) => products.some((product) => product.sku === sku)),
    true,
  );
  assert.equal(new Set(products.map((product) => product.sku)).size, products.length);
  assert.equal(products.length, new Set(products.map((product) => product.sku)).size);
  assert.ok(products.every((product) => product.image.startsWith('assets/catalog/beverages/')));
  assert.ok(products.every((product) => product.imageThumbnail.startsWith('assets/catalog/beverages/')));
  assert.ok(products.every((product) => !product.sku.startsWith('qa-')));
  assert.ok(products.every((product) => !`${product.image} ${product.imageThumbnail}`.includes('/qa-')));
  assert.ok(products.every((product) => !/^https?:/i.test(product.image) && !/^https?:/i.test(product.imageThumbnail)));
  assert.ok(products.every((product) => !/\b(?:pending|unresolved)\b/i.test(`${product.image} ${product.imageThumbnail}`)));

  const assets = products.flatMap((product) => [product.image, product.imageThumbnail]);
  assert.equal(assets.length, products.length * 2);
  assert.equal(new Set(assets).size, products.length * 2);
  for (const product of products) {
    assert.ok(fs.statSync(path.join(ROOT, product.image)).size > 0, `${product.sku}: product.webp`);
    assert.ok(fs.statSync(path.join(ROOT, product.imageThumbnail)).size > 0, `${product.sku}: thumbnail.webp`);
  }
});
test('packs, precios pendientes y alcohol conservan su semantica comercial', () => {
  const catalog = products.map((product) => normalizeCatalogProduct(product)).filter(Boolean);
  assert.equal(catalog.length, products.length);
  assert.equal(new Set(catalog.map((product) => product.sku)).size, catalog.length);
  const packSix = catalog.find((product) => product.sku === 'heineken-original-lata-473ml-pack-6');
  const packTwelve = catalog.find((product) => product.sku === 'coca-cola-original-pet-500ml-pack-12');
  const pending = catalog.find((product) => product.sku === 'red-bull-original-lata-250ml-pack-4');
  assert.deepEqual([packSix.unitLabel, packSix.unitsPerPack], ['Pack x6', 6]);
  assert.deepEqual([packTwelve.unitLabel, packTwelve.unitsPerPack], ['Pack x12', 12]);
  assert.equal(pending.pricePending, true);
  assert.equal(pending.price, 0);
  assert.equal(pending.oldPrice, undefined);
  assert.equal(pending.badge, undefined);
  assert.equal(isProductOrderable(pending), false);
  assert.ok(catalog.filter((product) => product.alcoholic).every((product) => product.requiresAgeConfirmation && product.minimumAge === 18));
  assert.ok(catalog.filter((product) => !product.alcoholic).every((product) => !product.requiresAgeConfirmation));
});
