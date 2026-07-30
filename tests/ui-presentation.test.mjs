import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { availabilityLabel, stockPill } from '../js/ui.js';
import { resetState } from './helpers.mjs';

beforeEach(() => resetState());

// La pill de stock sólo aparece cuando hay algo que avisar: el estado normal
// (disponible, con stock) no se etiqueta para no llenar el catálogo de cintas.
test('stockPill: producto disponible normal no muestra etiqueta', () => {
  assert.equal(stockPill({ available: true, stock: 12 }), '');
  assert.equal(stockPill({ available: true, stock: 12, featured: true }), '');
  assert.equal(stockPill({ available: true, stock: 12, badge: 'Retiro' }), '');
});

test('stockPill: estados que sí se avisan (agotado, pausado, últimas unidades, archivado)', () => {
  assert.match(stockPill({ available: true, stock: 0 }), /Agotado/);
  assert.match(stockPill({ available: false, stock: 10 }), /No disponible/);
  assert.match(stockPill({ available: true, stock: 3 }), /Quedan 3/);
  assert.match(stockPill({ available: true, stock: 5, archived: true }), /Archivado/);
});

test('pricePending: usa un único mensaje claro en vez de sumar una pill de stock', () => {
  const pending = { available: false, stock: 0, pricePending: true };
  assert.equal(stockPill(pending), '');
  assert.equal(
    availabilityLabel(pending),
    'Precio a confirmar; todavía no se puede agregar.',
  );
});

test('availabilityLabel: texto plano honesto para el detalle del producto', () => {
  assert.equal(availabilityLabel({ available: true, stock: 12 }), 'Disponible hoy');
  assert.equal(availabilityLabel({ available: true, stock: 2 }), 'Quedan 2');
  assert.equal(availabilityLabel({ available: true, stock: 0 }), 'Agotado');
  assert.equal(availabilityLabel({ available: false, stock: 9 }), 'No disponible por ahora');
});
