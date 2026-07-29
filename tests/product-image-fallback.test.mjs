import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { handleProductImageError, productThumb } from '../js/ui.js';
import { products } from '../js/approved-beverage-demo-data.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('all QA or unofficial products use the same neutral placeholder', () => {
  const qa = productThumb({ name: 'Bebida QA', categoryId: 'cervezas', qaFixture: true, image: 'assets/products/other.webp' });
  const unofficial = productThumb({ name: 'Producto sin aprobar', categoryId: 'cervezas', image: 'assets/products/unapproved.webp' });
  for (const html of [qa, unofficial]) {
    assert.match(html, /assets\/products\/beverage-placeholder\.svg/);
    assert.match(html, /uses-placeholder/);
    assert.match(html, /Producto sin imagen oficial/);
    assert.doesNotMatch(html, /<svg/);
    assert.doesNotMatch(html, /srcset=/);
  }
});

test('approved catalog products use existing local product and thumbnail routes', () => {
  for (const product of products) {
    assert.match(product.image, /^assets\/catalog\/beverages\/[^/]+\/product\.webp$/);
    assert.match(product.imageThumbnail, /^assets\/catalog\/beverages\/[^/]+\/thumbnail\.webp$/);
    assert.ok(fs.existsSync(path.join(root, product.image)), `${product.id}: product image does not exist`);
    assert.ok(fs.existsSync(path.join(root, product.imageThumbnail)), `${product.id}: thumbnail does not exist`);
  }
});

test('approved products provide responsive thumbnail/master source pairs', () => {
  for (const product of products) {
    const html = productThumb(product);
    assert.match(html, / srcset="/);
    assert.match(html, new RegExp(`${product.imageThumbnail} 400w`));
    assert.match(html, new RegExp(`${product.image} 1000w`));
  }
});

test('broken approved image switches to the neutral accessible fallback', () => {
  const imageClasses = classList('thumb-img');
  const shellClasses = classList('thumb', 'has-photo');
  const attributes = new Map();
  const shell = { classList: shellClasses, setAttribute(name, value) { attributes.set(name, value); } };
  const removed = [];
  const image = { classList: imageClasses, dataset: { productName: 'Producto aprobado' }, src: 'assets/products/broken.webp', closest: () => shell, removeAttribute(name) { removed.push(name); } };
  assert.equal(handleProductImageError({ target: image }), true);
  assert.equal(image.src, 'assets/products/beverage-placeholder.svg');
  assert.deepEqual(removed, ['srcset', 'sizes']);
  assert.equal(shellClasses.contains('has-photo'), false);
  assert.equal(shellClasses.contains('uses-placeholder'), true);
  assert.equal(attributes.get('aria-label'), 'Producto sin imagen oficial: Producto aprobado');
});

function classList(...initial) {
  const values = new Set(initial);
  return { add(value) { values.add(value); }, remove(value) { values.delete(value); }, contains(value) { return values.has(value); } };
}
