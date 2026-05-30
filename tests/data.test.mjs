import assert from 'node:assert/strict';
import test from 'node:test';
import { categories, products } from '../js/data.js';

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

test('catalog includes premium butcher products with real prices', () => {
  const names = new Set(products.map((product) => product.name));
  for (const expected of [
    'Bife ancho',
    'Ojo de bife',
    'Asado especial',
    'Vacío especial',
    'Matambre',
    'Carne picada especial',
    'Milanesa de carne',
    'Pollo entero',
    'Chorizo parrillero',
    'Morcilla',
    'Provoleta',
    'Combo parrillero',
    'Coca-Cola 2.25L',
    'Carbón 3 kg',
  ]) {
    assert.ok(names.has(expected), `missing product: ${expected}`);
  }
  assert.ok(products.every((product) => product.price > 0), 'products should not show zero prices');
});
