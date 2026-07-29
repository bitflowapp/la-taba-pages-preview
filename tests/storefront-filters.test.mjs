import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isFernetProduct,
  isPopularProduct,
  isPromotionalProduct,
  isUnitStorefrontProduct,
  uniqueProducts,
} from '../js/core/storefront-filters.js';

test('detecta promociones sólo mediante señales comerciales reales', () => {
  assert.equal(isPromotionalProduct({ id: 'badge', price: 10, homePromoBadge: '20% OFF' }), true);
  assert.equal(isPromotionalProduct({ id: 'price', price: 80, oldPrice: 100 }), true);
  assert.equal(isPromotionalProduct({ id: 'flag', price: 100 }, new Set(['flag'])), true);
  assert.equal(isPromotionalProduct({ id: 'regular', price: 100, oldPrice: 100 }), false);
  assert.equal(isPromotionalProduct({ id: 'invalid', price: 100, oldPrice: 90 }), false);
});

test('Fernet exige identidad textual real y rechaza gin, vodka y otras bebidas', () => {
  assert.equal(isFernetProduct({ id: 'fernet', brand: 'Fernet Branca', name: 'Fernet Branca 750 ml' }), true);
  assert.equal(isFernetProduct({ id: 'tagged', name: 'Aperitivo italiano', tags: ['fernet'] }), true);
  assert.equal(isFernetProduct({
    id: 'gin',
    brand: "Hendrick's",
    name: "Hendrick's Gin Original",
    categoryId: 'gins-y-vodkas',
  }), false);
  assert.equal(isFernetProduct({ id: 'vodka', name: 'Vodka clásico', categoryId: 'gins-y-vodkas' }), false);
  assert.equal(isFernetProduct({ id: 'whisky', name: 'Whisky escocés' }), false);
});

test('más vendidos usa sólo la bandera popular real y elimina duplicados', () => {
  assert.equal(isPopularProduct({ id: 'popular', popular: true }), true);
  assert.equal(isPopularProduct({ id: 'featured', featured: true }), false);
  assert.deepEqual(
    uniqueProducts([{ id: 'a' }, { id: 'a' }, { id: 'b' }, null]).map((product) => product.id),
    ['a', 'b'],
  );
});

test('el storefront unitario rechaza assets o cantidades de multipack', () => {
  assert.equal(isUnitStorefrontProduct({ id: 'unit', unitsPerPack: 1 }), true);
  assert.equal(isUnitStorefrontProduct({ id: 'strip', unitsPerPack: 1, imageShowsMultipack: true }), false);
  assert.equal(isUnitStorefrontProduct({ id: 'six', unitsPerPack: 6 }), false);
});
