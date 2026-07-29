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

test('el storefront unitario acepta una unidad válida y rechaza toda señal de multipack', () => {
  const unit = {
    id: 'unit',
    name: 'Bebida individual 473 ml',
    description: 'Lata 473 ml',
    unit: 'unidad',
    unitLabel: 'Lata 473 ml',
    packageType: 'lata',
    unitsPerPack: 1,
    imageShowsMultipack: false,
    price: 5000,
    stock: 4,
    available: true,
  };

  assert.equal(isUnitStorefrontProduct(unit), true);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'strip', imageShowsMultipack: true }), false);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'six', unitsPerPack: 6 }), false);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'copy-x6', name: 'Bebida x6' }), false);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'copy-pack', unitLabel: 'Pack de latas' }), false);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'package', packageType: 'pack' }), false);
  assert.equal(isUnitStorefrontProduct({ ...unit, id: 'missing-units', unitsPerPack: undefined }), false);
});
