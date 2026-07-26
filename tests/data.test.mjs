import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { categories, products } from '../js/data.js';

const EXPECTED_CATEGORY_IDS = [
  'all',
  'promos',
  'gaseosas',
  'aguas',
  'jugos',
  'energeticas',
  'isotonicas',
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
  'picadas-y-deli',
  'hielo-y-extras',
];
const ALCOHOLIC_CATEGORY_IDS = new Set([
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
]);

test('catalog data is internally consistent', () => {
  assert.ok(Array.isArray(categories) && categories.length > 0);
  assert.ok(Array.isArray(products) && products.length > 0);

  const categoryIds = new Set(categories.map((category) => category.id));
  const productIds = new Set();
  const productCountByCategory = new Map(categories.map((category) => [category.id, 0]));

  for (const product of products) {
    assert.ok(typeof product.id === 'string' && product.id.length > 0);
    assert.ok(!productIds.has(product.id), `duplicate product id: ${product.id}`);
    productIds.add(product.id);

    assert.ok(typeof product.name === 'string' && product.name.trim().length > 0);
    assert.ok(typeof product.categoryId === 'string' && product.categoryId.length > 0);
    assert.ok(categoryIds.has(product.categoryId), `missing category: ${product.categoryId}`);
    assert.ok(Number.isFinite(product.price) && product.price > 0);
    assert.ok(Number.isFinite(product.stock) && product.stock >= 0);
    assert.equal(typeof product.available, 'boolean');
    if ('featured' in product) assert.equal(typeof product.featured, 'boolean');

    if (productCountByCategory.has(product.categoryId)) {
      productCountByCategory.set(product.categoryId, productCountByCategory.get(product.categoryId) + 1);
    }
  }

  const orphanCategories = categories
    .filter((category) => category.id !== 'all' && (productCountByCategory.get(category.id) || 0) === 0)
    .map((category) => category.id);

  assert.deepEqual(orphanCategories, []);
});

test('preview catalog is beverages-only and internally marked as QA', () => {
  const categoryNames = new Set(categories.map((category) => category.name));
  for (const expected of ['Promos', 'Gaseosas', 'Aguas', 'Jugos', 'Cervezas', 'Hielo y extras']) {
    assert.ok(categoryNames.has(expected), `missing category: ${expected}`);
  }
  assert.ok(products.every((product) => product.qaFixture === true));
  assert.ok(products.every((product) => /Sin valor comercial/.test(product.marketNote)));
  assert.ok(products.every((product) => product.id.startsWith('qa-')));
  for (const product of products) {
    if (product.image) {
      assert.equal(product.image, 'assets/products/beverage-placeholder.svg');
    }
  }
});

test('preview categories use the canonical beverage ids', () => {
  assert.deepEqual(categories.map((category) => category.id), EXPECTED_CATEGORY_IDS);
});

test('preview alcohol metadata is inferred consistently from category', () => {
  for (const product of products) {
    const alcoholic = ALCOHOLIC_CATEGORY_IDS.has(product.categoryId);
    assert.equal(product.alcoholic, alcoholic, `unexpected alcoholic flag for ${product.id}`);
    assert.equal(product.minimumAge, alcoholic ? 18 : null, `unexpected minimum age for ${product.id}`);
  }
});

test('preview prices are neutral QA tiers, not market estimates', () => {
  const allowedPrices = new Set([5000, 7500, 10000, 15000]);
  assert.ok(products.every((product) => allowedPrices.has(product.price)));
});

test('active catalog and data module have no inherited pizzeria identifiers or names', () => {
  const forbidden = /\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i;
  for (const category of categories) {
    assert.doesNotMatch(`${category.id} ${category.name}`, forbidden);
  }
  for (const product of products) {
    assert.doesNotMatch(
      `${product.id} ${product.name} ${product.categoryId}`,
      forbidden,
      `inherited pizzeria identifier in active product ${product.id}`,
    );
  }
  const dataSource = fs.readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(dataSource, forbidden);
  assert.doesNotMatch(dataSource, /historicalPizzeria/i);
});
