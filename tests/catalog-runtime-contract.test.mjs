import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { cardTitle, cardPresentationLine, packUnitPrice } from '../js/core/product-presentation.js';
import { productPricePresentation, pricingLabel, stockPill } from '../js/ui.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const rows = read('catalog-cp-46.json').products;
const names = read('catalog-cp-names.json');

test('46 current commercial names have reviewed titles and presentations', () => {
  assert.equal(rows.length, 46);
  assert.equal(new Set(rows.map(p => p.sku)).size, 46);
  const actual = rows.map(p => ({ sku: p.sku, name: p.name, title: cardTitle(p), presentation: cardPresentationLine(p) }));
  assert.deepEqual(actual, names);
  for (const p of actual) {
    assert.ok(p.title.trim().length > 2);
    assert.doesNotMatch(p.title, /(?:^|\s)(?:undefined|null|SKU|importado|producto genérico)(?:\s|$)/i);
    assert.doesNotMatch(p.title, /\s\d+(?:[,.]\d+)?\s*(?:ml|L|g|kg)$/);
    assert.doesNotMatch(p.title, /\sSabor$/i);
    assert.ok(p.presentation.length > 0);
  }
});

test('capacity is removed only if the structured identity confirms it', () => {
  assert.equal(cardTitle({ name: 'Heineken Lager 710 ml', capacity_value: 710, capacity_unit: 'ml' }), 'Heineken Lager');
  assert.equal(cardTitle({ name: 'Heineken Lager 710 ml', capacity_value: 473, capacity_unit: 'ml' }), 'Heineken Lager 710 ml');
  assert.equal(cardTitle({ name: 'Heineken Lager 710 ml' }), 'Heineken Lager 710 ml');
  assert.equal(cardTitle({ name: 'Hielo Cristal 4 kg', capacity_value: 4000, capacity_unit: 'g' }), 'Hielo Cristal');
  assert.equal(cardTitle({ name: 'Coca-Cola Sabor Original 2,25 L', capacity_value: 2250, capacity_unit: 'ml' }), 'Coca-Cola');
});

test('pending wins over contradictory flags and every residual price', () => {
  for (const status of [{ price_status: 'pending' }, { priceStatus: 'pending' }, { price_status: 'pending', priceStatus: 'confirmed' }]) {
    const raw = { id: 'pending-test', name: 'Producto pendiente', categoryId: 'gaseosas', ...status,
      pricePending: false, price: 99999, oldPrice: 120000, regularPrice: 120000,
      unitsPerPack: 6, available: true, stock: 3 };
    const p = normalizeCatalogProduct(raw);
    assert.equal(p.price, null);
    assert.equal(p.pricePending, true);
    assert.equal(p.regularPrice, null);
    assert.equal(packUnitPrice(raw), null);
    assert.equal(stockPill(raw), '');
    assert.equal(productPricePresentation(raw).regularPrice, null);
    assert.equal(pricingLabel(productPricePresentation(raw)), 'Precio próximamente');
  }
});
