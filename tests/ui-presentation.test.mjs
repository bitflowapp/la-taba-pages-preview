import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { availabilityLabel, stockPill } from '../js/ui.js';
import { resetState } from './helpers.mjs';

beforeEach(() => resetState());

// These cases isolate stock states on a product with a confirmed price. The
// pending-price case below keeps testing its own, stricter commercial state.
const priced = (fields) => ({ price: 2500, price_status: 'confirmed', ...fields });

// La pill de stock sólo aparece cuando hay algo que avisar: el estado normal
// (disponible, con stock) no se etiqueta para no llenar el catálogo de cintas.
test('stockPill: producto disponible normal no muestra etiqueta', () => {
  assert.equal(stockPill(priced({ available: true, stock: 12 })), '');
  assert.equal(stockPill(priced({ available: true, stock: 12, featured: true })), '');
  assert.equal(stockPill(priced({ available: true, stock: 12, badge: 'Retiro' })), '');
});

test('stockPill: estados que sí se avisan (agotado, pausado, últimas unidades, archivado)', () => {
  assert.match(stockPill(priced({ available: true, stock: 0 })), /Agotado/);
  assert.match(stockPill(priced({ available: false, stock: 10 })), /No disponible/);
  assert.match(stockPill(priced({ available: true, stock: 3 })), /Últimas 3/);
  assert.match(stockPill(priced({ available: true, stock: 5, archived: true })), /Archivado/);
});

test('pricePending: usa un único mensaje claro en vez de sumar una pill de stock', () => {
  const pending = { available: false, stock: 0, pricePending: true };
  assert.equal(stockPill(pending), '');
  assert.equal(
    availabilityLabel(pending),
    'Precio próximamente; este producto todavía no está disponible para compra.',
  );
});

test('availabilityLabel: texto plano honesto para el detalle del producto', () => {
  assert.equal(availabilityLabel(priced({ available: true, stock: 12 })), 'Disponible');
  assert.equal(availabilityLabel(priced({ available: true, stock: 2 })), 'Últimas 2');
  assert.equal(availabilityLabel(priced({ available: true, stock: 0 })), 'Agotado');
  assert.equal(availabilityLabel(priced({ available: false, stock: 9 })), 'No disponible por ahora');
});
