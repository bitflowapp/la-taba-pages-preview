import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STORAGE_KEYS, SHOWCASE_STORAGE_KEYS } from '../js/config.js';
import {
  PRODUCTION_CART_MAX_AGE_MS,
  PRODUCTION_CART_SCHEMA_VERSION,
  readProductionCart,
  sanitizeProductionCartSnapshot,
  writeProductionCart,
} from '../js/core/production-cart-storage.js';

const KEY = DEFAULT_STORAGE_KEYS.productionCart;
const T0 = Date.parse('2026-08-10T20:00:00.000Z');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('el carrito productivo persiste sólo ids y cantidades saneadas', () => {
  const storage = memoryStorage();

  assert.equal(writeProductionCart(storage, KEY, {
    customerName: 'No debe persistir',
    customerPhone: '2995550000',
    address: 'Roca 123',
    checkoutToken: 'secret',
    cart: [
      { productId: '30000000-0000-4000-8000-000000000001', quantity: 1, name: 'Cerveza' },
      { productId: '30000000-0000-4000-8000-000000000001', quantity: 2, price: 4000 },
      { productId: '<script>', quantity: 4 },
      { productId: 'valid-but-empty', quantity: 0 },
    ],
    comboSelections: [
      { comboId: 'combo-previa-x6', quantity: 2, total: 99_999 },
    ],
  }, { now: T0 }), true);

  const raw = storage.getItem(KEY);
  assert.deepEqual(JSON.parse(raw), {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart: [{ productId: '30000000-0000-4000-8000-000000000001', quantity: 3 }],
    comboSelections: [{ comboId: 'combo-previa-x6', quantity: 2 }],
    savedAt: new Date(T0).toISOString(),
  });
  assert.doesNotMatch(raw, /No debe persistir|2995550000|Roca 123|secret|Cerveza|99999/);
});

test('recargar en la misma pestaña recupera exactamente lo guardado', () => {
  const storage = memoryStorage();
  const cart = [
    { productId: '30000000-0000-4000-8000-000000000001', quantity: 2 },
    { productId: '30000000-0000-4000-8000-000000000002', quantity: 1 },
  ];

  writeProductionCart(storage, KEY, { cart }, { now: T0 });

  // La recarga es exactamente esto: una lectura nueva sobre el mismo storage.
  assert.deepEqual(readProductionCart(storage, KEY, { now: T0 + 5_000 }), {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart,
    comboSelections: [],
  });
});

test('la lectura rechaza esquemas viejos, corrupción y cantidades abusivas', () => {
  const storage = memoryStorage();

  storage.setItem(KEY, '{mal json');
  assert.deepEqual(readProductionCart(storage, KEY, { now: T0 }), {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart: [],
    comboSelections: [],
  });
  assert.equal(storage.getItem(KEY), null, 'un payload corrupto no se deja en el disco del cliente');

  storage.setItem(KEY, JSON.stringify({
    schemaVersion: 1,
    cart: [{ productId: 'old-product', quantity: 1 }],
  }));
  assert.equal(readProductionCart(storage, KEY, { now: T0 }).cart.length, 0);
  assert.equal(storage.getItem(KEY), null, 'el esquema viejo se borra, no se reinterpreta');

  assert.deepEqual(sanitizeProductionCartSnapshot({
    cart: [{ productId: 'safe-product', quantity: 50_000 }],
  }).cart, [{ productId: 'safe-product', quantity: 999 }]);
});

test('un carrito que nadie tocó vence y se borra; el plazo cuenta desde el último cambio real', () => {
  const storage = memoryStorage();
  const cart = [{ productId: 'safe-product', quantity: 1 }];

  writeProductionCart(storage, KEY, { cart }, { now: T0 });

  // Guardar de nuevo lo MISMO no reinicia el plazo: la aplicación persiste en
  // cada cambio de estado y si cada guardado lo refrescara nunca vencería.
  writeProductionCart(storage, KEY, { cart }, { now: T0 + PRODUCTION_CART_MAX_AGE_MS - 1000 });
  assert.equal(
    JSON.parse(storage.getItem(KEY)).savedAt,
    new Date(T0).toISOString(),
  );

  assert.equal(readProductionCart(storage, KEY, { now: T0 + PRODUCTION_CART_MAX_AGE_MS - 1 }).cart.length, 1);
  assert.equal(readProductionCart(storage, KEY, { now: T0 + PRODUCTION_CART_MAX_AGE_MS + 1 }).cart.length, 0);
  assert.equal(storage.getItem(KEY), null, 'el carrito vencido se borra en la lectura');

  // Un cambio real sí reinicia el plazo.
  writeProductionCart(storage, KEY, { cart }, { now: T0 });
  writeProductionCart(storage, KEY, {
    cart: [{ productId: 'safe-product', quantity: 2 }],
  }, { now: T0 + 60_000 });
  assert.equal(
    JSON.parse(storage.getItem(KEY)).savedAt,
    new Date(T0 + 60_000).toISOString(),
  );
});

test('una marca de tiempo ausente, ilegible o lejana en el futuro no revive el carrito', () => {
  const storage = memoryStorage();
  const cart = [{ productId: 'safe-product', quantity: 1 }];

  for (const savedAt of [undefined, '', 'ayer', null, new Date(T0 + PRODUCTION_CART_MAX_AGE_MS * 4).toISOString()]) {
    storage.setItem(KEY, JSON.stringify({
      schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
      cart,
      comboSelections: [],
      savedAt,
    }));
    assert.equal(readProductionCart(storage, KEY, { now: T0 }).cart.length, 0, `savedAt=${savedAt}`);
    assert.equal(storage.getItem(KEY), null);
  }

  // Un reloj apenas corrido —dentro del mismo plazo— no le cuesta el carrito a
  // nadie.
  storage.setItem(KEY, JSON.stringify({
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart,
    comboSelections: [],
    savedAt: new Date(T0 + 60 * 60 * 1000).toISOString(),
  }));
  assert.equal(readProductionCart(storage, KEY, { now: T0 }).cart.length, 1);
});

test('vaciar el carrito elimina la clave y showcase queda aislado', () => {
  const storage = memoryStorage();

  writeProductionCart(storage, KEY, { cart: [{ productId: 'safe-product', quantity: 1 }] }, { now: T0 });
  assert.ok(storage.getItem(KEY));
  assert.equal(writeProductionCart(storage, KEY, { cart: [], comboSelections: [] }, { now: T0 }), true);
  assert.equal(storage.getItem(KEY), null);
  assert.notEqual(DEFAULT_STORAGE_KEYS.productionCart, SHOWCASE_STORAGE_KEYS.productionCart);
});

test('un storage que lanza no rompe la lectura ni el guardado', () => {
  const hostile = {
    getItem() { throw new Error('storage bloqueado'); },
    setItem() { throw new Error('storage bloqueado'); },
    removeItem() { throw new Error('storage bloqueado'); },
  };

  assert.deepEqual(readProductionCart(hostile, KEY, { now: T0 }), {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart: [],
    comboSelections: [],
  });
  assert.equal(writeProductionCart(hostile, KEY, {
    cart: [{ productId: 'safe-product', quantity: 1 }],
  }, { now: T0 }), false);
});
