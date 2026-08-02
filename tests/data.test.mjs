import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { categories, products } from '../js/approved-beverage-demo-data.js';
import {
  getAlcoholProduct,
  getNonAlcoholProduct,
  getPricePendingProduct,
  getPurchasablePackProduct,
  getPurchasableUnitProduct,
} from './fixtures/approved-catalog-selectors.mjs';

const LEGACY_CATEGORY_IDS = ['all', 'gaseosas', 'mixers', 'energizantes', 'cervezas'];

test('approved demo catalog is internally consistent', () => {
  assert.deepEqual(categories.slice(0, LEGACY_CATEGORY_IDS.length).map((category) => category.id), LEGACY_CATEGORY_IDS);
  assert.equal(products.length, 62);
  assert.equal(new Set(products.map((product) => product.sku)).size, products.length);

  const categoryIds = new Set(categories.map((category) => category.id));
  for (const product of products) {
    assert.equal(product.id, product.sku);
    assert.ok(!product.sku.startsWith('qa-'));
    assert.ok(categoryIds.has(product.categoryId), `missing category: ${product.categoryId}`);
    assert.ok(product.name.trim().length > 0);
    assert.ok(product.pricePending ? product.price === null : Number.isFinite(product.price) && product.price > 0);
    assert.ok(Number.isFinite(product.stock) && product.stock >= 0);
    assert.ok(product.unitsPerPack >= 1);
    assert.equal(typeof product.available, 'boolean');
  }
});

test('approved demo images are local and complete', () => {
  for (const product of products) {
    assert.match(product.image, /^assets\/catalog\/(?:beverages\/[^/]+\/product|products\/[^/]+\/[^/]+-master)\.webp$/);
    assert.match(product.imageThumbnail, /^assets\/catalog\/(?:beverages\/[^/]+\/thumbnail|products\/[^/]+\/[^/]+-thumb)\.webp$/);
    assert.doesNotMatch(product.image, /^https?:\/\//i);
    assert.doesNotMatch(product.imageThumbnail, /^https?:\/\//i);
    assert.ok(fs.existsSync(new URL(`../${product.image}`, import.meta.url)));
    assert.ok(fs.existsSync(new URL(`../${product.imageThumbnail}`, import.meta.url)));
  }
});

test('approved semantic selectors preserve units, packs, alcohol and pending price contracts', () => {
  const unit = getPurchasableUnitProduct(products);
  const pack = getPurchasablePackProduct(products);
  const alcohol = getAlcoholProduct(products);
  const nonAlcohol = getNonAlcoholProduct(products);
  const pending = getPricePendingProduct(products);

  assert.equal(unit.unitsPerPack, 1);
  assert.ok(pack.unitsPerPack === 6 || pack.unitsPerPack === 12);
  assert.equal(alcohol.requiresAgeConfirmation, true);
  assert.equal(nonAlcohol.requiresAgeConfirmation, false);
  assert.equal(pending.price, null);
  assert.equal(pending.available, false);
});

test('approved packs retain x6 and x12 as commercial presentations', () => {
  const packSizes = new Set(products
    .filter((product) => product.unitsPerPack > 1)
    .map((product) => product.unitsPerPack));
  assert.ok(packSizes.has(6));
  assert.ok(packSizes.has(12));
  assert.ok(products.some((product) => product.unitsPerPack === 1));
});

test('active catalog and data module have no inherited pizzeria identifiers or names', () => {
  const forbidden = /\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i;
  for (const category of categories) assert.doesNotMatch(`${category.id} ${category.name}`, forbidden);
  for (const product of products) assert.doesNotMatch(`${product.id} ${product.name} ${product.categoryId}`, forbidden);
  assert.doesNotMatch(fs.readFileSync(new URL('../js/data.js', import.meta.url), 'utf8'), forbidden);
});

test('browser runtime seeds reference approved SKUs instead of legacy QA products', () => {
  const runtimeSources = [
    '../js/data.js',
    '../js/preview-promotions-data.js',
    '../js/ui.js',
    '../data/preview-promotions.csv',
  ];
  for (const source of runtimeSources) {
    assert.doesNotMatch(
      fs.readFileSync(new URL(source, import.meta.url), 'utf8'),
      /\bqa-[a-z0-9-]+\b/i,
      source,
    );
  }
});
